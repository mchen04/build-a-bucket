import { describe, expect, it } from 'vitest';
import { activityLine, phaseLabel, readyLabel, shortStatus, statusLine } from '../src/app/mp/format';
import type { EventView, ParticipantView } from '../src/shared/mp/types';

function participant(overrides: Partial<ParticipantView> = {}): ParticipantView {
  return {
    seat: 1,
    name: 'P1',
    isHost: true,
    isMe: true,
    away: false,
    status: 'building',
    joinedAt: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-01-01T00:00:00.000Z',
    team: null,
    rerollUsed: false,
    build: null,
    summary: null,
    buildSeed: null,
    ready: false,
    season: null,
    ...overrides,
  };
}

function event(overrides: Partial<EventView> = {}): EventView {
  return { id: 1, kind: 'pick', seat: 1, name: 'Dev', detail: null, at: '2026-01-01T00:00:00.000Z', ...overrides };
}

describe('phase labels', () => {
  it('names every phase', () => {
    expect(phaseLabel('lobby')).toBe('In the lobby');
    expect(phaseLabel('draw')).toBe('Team draw');
    expect(phaseLabel('building')).toBe('Building');
    expect(phaseLabel('preview')).toBe('Team preview');
    expect(phaseLabel('season')).toBe('Season running');
    expect(phaseLabel('awards')).toBe('Awards');
    expect(phaseLabel('playin')).toBe('Play-In');
    expect(phaseLabel('playoffs')).toBe('Playoffs');
    expect(phaseLabel('recap')).toBe('Recap');
    expect(phaseLabel('rematch')).toBe('Play again');
  });
});

describe('participant status', () => {
  it('shows left and away first', () => {
    expect(statusLine(participant({ status: 'left' }), 'season')).toBe('left');
    expect(statusLine(participant({ away: true }), 'season')).toBe('away');
    expect(shortStatus(participant({ status: 'left' }), 'season')).toBe('left');
    expect(shortStatus(participant({ away: true }), 'season')).toBe('away');
  });

  it('shows the team and the revealed record', () => {
    expect(statusLine(participant({ team: 'BOS' }), 'building')).toBe('BOS');
    expect(shortStatus(participant({ team: 'BOS' }), 'building')).toBe('BOS');
    expect(
      statusLine(participant({ team: 'BOS', season: { wins: 50, losses: 32, seed: null, finish: null, champion: false } }), 'season'),
    ).toBe('50-32');
    expect(
      statusLine(participant({ team: 'BOS', season: { wins: 50, losses: 32, seed: 3, finish: null, champion: false } }), 'awards'),
    ).toBe('50-32 · #3');
    expect(
      statusLine(participant({ team: 'BOS', season: { wins: 50, losses: 32, seed: 3, finish: 'Champion', champion: true } }), 'recap'),
    ).toBe('Champion · 50-32');
  });

  it('shows build progress before a team exists', () => {
    expect(statusLine(participant({ status: 'ready' }), 'building')).toBe('ready');
    expect(statusLine(participant({ summary: { filled: 4, total: 10, latest: null, ovr: 0, auto: false } }), 'building')).toBe('4/10');
    expect(shortStatus(participant({ summary: { filled: 4, total: 10, latest: null, ovr: 0, auto: false } }), 'building')).toBe('4/10');
  });

  it('labels readiness', () => {
    expect(readyLabel({ ready: 3, present: 5, mine: false })).toBe('3/5 ready');
  });
});

describe('activity line', () => {
  it('renders the newest event as one line', () => {
    expect(activityLine(event({ kind: 'pick', detail: "took Kyrie Irving's FIN A+" }))).toBe(
      "Dev took Kyrie Irving's FIN A+",
    );
    expect(activityLine(event({ kind: 'draw', detail: 'drew a team' }))).toBe('Dev drew a team');
    expect(activityLine(event({ kind: 'checkpoint', name: null }))).toBe('reached a checkpoint');
    expect(activityLine(event({ kind: 'host_changed', name: 'Gus' }))).toBe('Gus is the new host');
    expect(activityLine(undefined)).toBe('Waiting for the first move');
  });
});
