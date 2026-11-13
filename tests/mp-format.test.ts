import { describe, expect, it } from 'vitest';
import { activityLine, readyLabel, shortStatus, statusLine } from '../src/app/mp/format';
import type { EventView, ParticipantStatus, ParticipantView, SeasonSummary } from '../src/shared/mp/types';

function season(overrides: Partial<SeasonSummary> = {}): SeasonSummary {
  return {
    wins: 46,
    losses: 36,
    ovr: 80,
    seed: 3,
    ppg: 25,
    rpg: 6,
    apg: 7,
    madePlayoffs: true,
    champion: false,
    archetype: 'Sharpshooter',
    team: 'OKC',
    qualified: true,
    finishRank: 5,
    finishLabel: null,
    ...overrides,
  };
}

function participant(
  seat: number,
  status: ParticipantStatus,
  overrides: Partial<ParticipantView> = {},
): ParticipantView {
  return {
    seat,
    name: `P${seat}`,
    isHost: seat === 1,
    isMe: false,
    away: false,
    status,
    joinedAt: new Date(0).toISOString(),
    lastSeen: new Date(0).toISOString(),
    build: null,
    summary: null,
    season: null,
    rounds: [],
    roundsTotal: 0,
    ...overrides,
  };
}

function event(overrides: Partial<EventView>): EventView {
  return { id: 1, kind: 'pick', seat: null, name: null, detail: null, at: '', ...overrides };
}

describe('roster labels', () => {
  it('counts every player with a result as ready, excludes left and away, and ignores the phase', () => {
    const roster = [
      participant(1, 'qualified', { season: season() }),
      participant(2, 'eliminated', { season: season({ qualified: false, finishLabel: 'Missed playoffs' }) }),
      participant(3, 'playoffs', { season: season() }),
      participant(4, 'done', { season: season({ finishLabel: 'Semis' }) }),
      participant(5, 'joined'),
      participant(6, 'building', { summary: { filled: 3, total: 10, latest: 'Kyrie Irving' } }),
      participant(7, 'left'),
      participant(8, 'joined', { away: true }),
    ];
    expect(readyLabel(roster)).toBe('4/6 ready');

    const allDone = roster.map((entry) =>
      entry.seat <= 6 ? { ...entry, status: 'done' as ParticipantStatus, season: season() } : entry,
    );
    expect(readyLabel(allDone)).toBe('6/6 ready');
  });

  it('shows live progress for a building peer', () => {
    const building = participant(3, 'building', { summary: { filled: 4, total: 10, latest: 'Kyrie Irving' } });
    expect(shortStatus(building, 'building')).toBe('4/10');
    expect(statusLine(building, 'building')).toBe('4/10 · Kyrie Irving');
    const untouched = participant(4, 'joined');
    expect(shortStatus(untouched, 'building')).toBe('—');
    expect(shortStatus(untouched, 'lobby')).toBe('ready');
  });

  it('never prints a null finish label while a run is still being revealed', () => {
    const live = participant(4, 'playoffs', {
      season: season({ finishLabel: null }),
      rounds: [{ name: 'First Round', opponent: 'BOS', won: true, wins: 4, losses: 2, label: null }],
    });
    expect(statusLine(live, 'playoffs')).toBe('First Round: 4-2');
    expect(statusLine(live, 'playoffs')).not.toContain('null');
    expect(statusLine({ ...live, status: 'done', season: season({ finishLabel: null }) }, 'playoffs')).toBe(
      'in the playoffs',
    );
  });

  it('labels a champion as champion and never as out', () => {
    const champion = participant(1, 'done', { season: season({ champion: true, finishLabel: 'Champion' }) });
    expect(shortStatus(champion, 'finished')).toBe('champ');
    expect(statusLine(champion, 'finished')).toBe('Champion');

    const knockedOut = participant(2, 'done', { season: season({ qualified: false, finishLabel: 'Missed playoffs' }) });
    expect(shortStatus(knockedOut, 'finished')).toBe('out');
    expect(statusLine(knockedOut, 'finished')).toBe('Missed playoffs');
  });
});

describe('activity line', () => {
  it('renders the newest event as one line', () => {
    expect(activityLine(event({ kind: 'pick', name: 'Dev', detail: "took Kyrie Irving's FIN A+" }))).toBe(
      "Dev took Kyrie Irving's FIN A+",
    );
    expect(activityLine(event({ kind: 'qualified', name: 'Eli', detail: 'finished 51-31, #3 seed' }))).toBe(
      'Eli finished 51-31, #3 seed',
    );
    expect(activityLine(event({ kind: 'barrier', name: 'Gus' }))).toBe('Gus is waiting at the playoff barrier');
    expect(activityLine(event({ kind: 'playoffs_started', name: null }))).toBe('the playoffs have started');
    expect(activityLine(undefined)).toBe('Waiting for the first move');
  });
});
