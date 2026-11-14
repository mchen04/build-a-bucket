import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { mergeDelta, progressToken } from '../src/shared/mp/progress';
import { EVENT_LIMIT, type EventView, type LobbyDelta, type LobbyView, type ParticipantView } from '../src/shared/mp/types';
import { buildLobbyDelta } from '../src/server/lobby';
import { LobbyDeltaSchema } from '../src/shared/mp/schemas';

function event(id: number, overrides: Partial<EventView> = {}): EventView {
  return { id, kind: 'pick', seat: 1, name: 'P1', detail: 'took a shot', at: '2026-01-01T00:00:00.000Z', ...overrides };
}

function participant(seat: number, overrides: Partial<ParticipantView> = {}): ParticipantView {
  return {
    seat,
    name: `P${seat}`,
    isHost: seat === 1,
    isMe: seat === 1,
    away: false,
    status: 'building',
    joinedAt: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-01-01T00:00:00.000Z',
    team: null,
    rerollUsed: false,
    build: null,
    summary: { filled: 0, total: 10, latest: null, ovr: 0, auto: false },
    buildSeed: null,
    ready: false,
    season: null,
    ...overrides,
  };
}

function view(overrides: Partial<LobbyView> = {}): LobbyView {
  const participants = [participant(1), participant(2)];
  return {
    code: 'ABC234',
    phase: 'building',
    version: 7,
    settings: { era: 'current', mode: 'normal' },
    capacity: 8,
    seatsTaken: 2,
    hostSeat: 1,
    stage: 0,
    stageName: '',
    stageTotal: 0,
    stageCursor: 0,
    checkpoint: false,
    stageStartedAt: null,
    participants,
    me: participants[0] as ParticipantView,
    events: [event(10)],
    teams: [],
    salaryBoard: null,
    salaryBudget: null,
    salaryPowers: null,
    league: null,
    ready: { ready: 0, present: 2, mine: false },
    serverTime: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('progress token', () => {
  it('tracks the newest event, away seats, filled slots, teams and ready flags', () => {
    expect(progressToken(view())).toBe('10::0:1::0,2::0');
    expect(progressToken(view({ events: [event(11), event(10)] }))).toBe('11::0:1::0,2::0');
    expect(progressToken(view({ participants: [participant(1, { away: true }), participant(2)] }))).toBe('10:1:0:1::0,2::0');
    expect(
      progressToken(view({ participants: [participant(1, { away: true }), participant(2, { away: true })] })),
    ).toBe('10:1,2:0:1::0,2::0');
    expect(
      progressToken(
        view({
          participants: [
            participant(1, { summary: { filled: 4, total: 10, latest: null, ovr: 0, auto: false }, team: 'BOS', ready: true }),
            participant(2),
          ],
        }),
      ),
    ).toBe('10::4:1:BOS:1,2::0');
  });

  it('notices an away flag that moved to another seat', () => {
    const before = view({ participants: [participant(1, { away: true }), participant(2)] });
    const after = view({ participants: [participant(1), participant(2, { away: true })] });
    expect(progressToken(before)).not.toBe(progressToken(after));
  });
});

describe('delta merge', () => {
  it('applies progress to each seat and keeps the rest of the view', () => {
    const base = view({ participants: [participant(1), participant(2)] });
    const delta: LobbyDelta = {
      version: 7,
      serverTime: '2026-01-01T00:00:05.000Z',
      participants: [
        { seat: 1, status: 'ready', away: false, summary: { filled: 9, total: 10, latest: 'Michael Jordan', ovr: 88, auto: false }, team: 'BOS', ready: true },
        { seat: 2, status: 'building', away: true, summary: { filled: 10, total: 10, latest: 'Larry Bird', ovr: 90, auto: false }, team: 'LAL', ready: false },
      ],
      events: [event(11, { seat: 2, name: 'P2' })],
    };
    const merged = mergeDelta(base, delta);
    expect(merged.version).toBe(7);
    expect(merged.serverTime).toBe(delta.serverTime);
    expect(merged.participants[0]?.summary?.filled).toBe(9);
    expect(merged.participants[0]?.team).toBe('BOS');
    expect(merged.participants[0]?.ready).toBe(true);
    expect(merged.participants[1]?.status).toBe('building');
    expect(merged.participants[1]?.away).toBe(true);
    expect(merged.participants[1]?.joinedAt).toBe(base.participants[1]?.joinedAt);
    expect(merged.me.seat).toBe(1);
    expect(merged.events.map((entry) => entry.id)).toEqual([11, 10]);
  });

  it('leaves seats the delta does not mention alone', () => {
    const base = view({ participants: [participant(1), participant(2, { status: 'ready' })] });
    const delta: LobbyDelta = {
      version: 8,
      serverTime: '2026-01-01T00:00:06.000Z',
      participants: [
        { seat: 1, status: 'building', away: false, summary: { filled: 1, total: 10, latest: 'Kobe Bryant', ovr: 70, auto: false }, team: null, ready: false },
      ],
      events: [],
    };
    const merged = mergeDelta(base, delta);
    expect(merged.participants[1]?.status).toBe('ready');
    expect(merged.participants[0]?.summary?.filled).toBe(1);
  });

  it('caps the event list', () => {
    const base = view({ events: Array.from({ length: EVENT_LIMIT }, (_, index) => event(index + 1)) });
    const delta: LobbyDelta = {
      version: 9,
      serverTime: '2026-01-01T00:00:07.000Z',
      participants: [],
      events: [event(100)],
    };
    const merged = mergeDelta(base, delta);
    expect(merged.events).toHaveLength(EVENT_LIMIT);
    expect(merged.events[0]?.id).toBe(100);
  });

  it('applies a participant season carried by a league delta', () => {
    const base = view({
      participants: [
        participant(1, { season: { wins: 1, losses: 0, seed: null, finish: null, champion: false } }),
        participant(2, { season: { wins: 0, losses: 1, seed: null, finish: null, champion: false } }),
      ],
    });
    const delta: LobbyDelta = {
      version: 10,
      serverTime: '2026-01-01T00:00:08.000Z',
      participants: [{ seat: 1, season: { wins: 2, losses: 1, seed: null, finish: null, champion: false } }],
      events: [],
    };
    const merged = mergeDelta(base, delta);
    expect(merged.participants[0]?.season).toEqual({ wins: 2, losses: 1, seed: null, finish: null, champion: false });
    expect(merged.participants[0]?.status).toBe('building');
    expect(merged.participants[0]?.summary?.filled).toBe(0);
    expect(merged.participants[1]?.season?.wins).toBe(0);
  });

  it('includes the participant season in the full delta', () => {
    const base = view({
      participants: [
        participant(1, { season: { wins: 3, losses: 2, seed: null, finish: null, champion: false } }),
        participant(2),
      ],
    });
    const delta = buildLobbyDelta(base, 0);
    expect(delta.participants?.[0]?.season?.wins).toBe(3);
    expect(delta.participants?.[0]?.season?.losses).toBe(2);
  });

  it('accepts a delta that only carries a participant season', () => {
    const parsed = v.safeParse(LobbyDeltaSchema, {
      version: 11,
      serverTime: '2026-01-01T00:00:09.000Z',
      participants: [{ seat: 1, season: { wins: 2, losses: 1, seed: null, finish: null, champion: false } }],
      events: [],
    });
    expect(parsed.success).toBe(true);
  });
});
