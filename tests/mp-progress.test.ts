import { describe, expect, it } from 'vitest';
import { mergeDelta, progressToken } from '../src/shared/mp/progress';
import { EVENT_LIMIT, type EventView, type LobbyDelta, type LobbyView, type ParticipantView } from '../src/shared/mp/types';

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
    build: null,
    summary: { filled: 0, total: 10, latest: null },
    season: null,
    rounds: [],
    roundsTotal: 0,
    ...overrides,
  };
}

function view(overrides: Partial<LobbyView> = {}): LobbyView {
  const participants = [participant(1), participant(2)];
  return {
    code: 'ABC234',
    phase: 'building',
    version: 7,
    settings: { era: 'current', positions: ['guard', 'big'], revealSeconds: 5 },
    capacity: 8,
    seatsTaken: 2,
    hostSeat: 1,
    playoffsStartedAt: null,
    revealSeconds: 5,
    roundsRevealed: 0,
    roundsTotal: 0,
    participants,
    me: participants[0] as ParticipantView,
    events: [event(10)],
    standings: null,
    serverTime: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('progress token', () => {
  it('tracks the newest event, away seats and filled slots', () => {
    expect(progressToken(view())).toBe('10::0');
    expect(progressToken(view({ events: [event(11), event(10)] }))).toBe('11::0');
    expect(progressToken(view({ participants: [participant(1, { away: true }), participant(2)] }))).toBe('10:1:0');
    expect(progressToken(view({ participants: [participant(1, { away: true }), participant(2, { away: true })] }))).toBe(
      '10:1,2:0',
    );
    expect(
      progressToken(view({ participants: [participant(1, { summary: { filled: 4, total: 10, latest: null } }), participant(2)] })),
    ).toBe('10::4');
  });

  it('notices an away flag that moved to another seat', () => {
    const before = view({ participants: [participant(1, { away: true }), participant(2)] });
    const after = view({ participants: [participant(1), participant(2, { away: true })] });
    expect(progressToken(before)).not.toBe(progressToken(after));
  });
});

describe('delta merge', () => {
  it('applies progress to each seat and keeps the rest of the view', () => {
    const base = view({ participants: [participant(1, { build: null }), participant(2, { status: 'building' })] });
    const delta: LobbyDelta = {
      version: 7,
      serverTime: '2026-01-01T00:00:05.000Z',
      participants: [
        { seat: 1, status: 'building', away: false, summary: { filled: 9, total: 10, latest: 'Michael Jordan' } },
        { seat: 2, status: 'playoffs', away: true, summary: { filled: 10, total: 10, latest: 'Larry Bird' } },
      ],
      events: [event(11, { seat: 2, name: 'P2' })],
    };
    const merged = mergeDelta(base, delta);
    expect(merged.version).toBe(7);
    expect(merged.serverTime).toBe(delta.serverTime);
    expect(merged.participants[0]?.summary?.filled).toBe(9);
    expect(merged.participants[1]?.status).toBe('playoffs');
    expect(merged.participants[1]?.away).toBe(true);
    expect(merged.participants[1]?.joinedAt).toBe(base.participants[1]?.joinedAt);
    expect(merged.me.seat).toBe(1);
    expect(merged.events.map((entry) => entry.id)).toEqual([11, 10]);
    expect(progressToken(merged)).toBe('11:2:19');
  });

  it('leaves seats the delta does not mention alone', () => {
    const base = view({ participants: [participant(1), participant(2, { status: 'qualified' })] });
    const delta: LobbyDelta = {
      version: 8,
      serverTime: '2026-01-01T00:00:06.000Z',
      participants: [{ seat: 1, status: 'building', away: false, summary: { filled: 1, total: 10, latest: 'Kobe Bryant' } }],
      events: [],
    };
    const merged = mergeDelta(base, delta);
    expect(merged.participants[1]?.status).toBe('qualified');
    expect(merged.participants[0]?.summary?.filled).toBe(1);
  });

  it('keeps at most a screenful of events', () => {
    const base = view({ events: Array.from({ length: EVENT_LIMIT }, (_, index) => event(EVENT_LIMIT - index)) });
    const delta: LobbyDelta = {
      version: 9,
      serverTime: '2026-01-01T00:00:07.000Z',
      participants: [],
      events: [event(EVENT_LIMIT + 2), event(EVENT_LIMIT + 1)],
    };
    const merged = mergeDelta(base, delta);
    expect(merged.events).toHaveLength(EVENT_LIMIT);
    expect(merged.events[0]?.id).toBe(EVENT_LIMIT + 2);
  });
});
