import { describe, expect, it } from 'vitest';
import { revealedCount, revealSeasonSummary } from '../src/server/lobby';
import type { PlayoffRound, SeasonResult } from '../src/shared/engine/types';

const ROUND_NAMES = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'];

function fakeSeason(rounds: number, champion: boolean): SeasonResult {
  const playoffRounds: PlayoffRound[] = [];
  for (let index = 0; index < rounds; index++) {
    const last = index === rounds - 1;
    playoffRounds.push({
      type: 'series',
      name: ROUND_NAMES[index] ?? 'NBA Finals',
      won: champion ? true : !last,
      wins: champion ? 4 : last ? 2 : 4,
      losses: champion ? 1 : last ? 4 : 2,
      opponent: { short: 'BOS', wins: champion ? 1 : last ? 4 : 2 },
      games: [],
      seed: 3,
      newSeed: null,
      label: null,
    } as unknown as PlayoffRound);
  }
  return {
    wins: 50,
    losses: 32,
    ovr: 84,
    seed: 3,
    ppg: 27,
    rpg: 6,
    apg: 7,
    madePlayoffs: true,
    champion,
    archetype: 'Sharpshooter',
    team: 'OKC',
    playoffRounds,
  } as unknown as SeasonResult;
}

describe('reveal projection', () => {
  it('hides the finish label and the champion flag until the run is fully revealed', () => {
    const deep = fakeSeason(4, false);
    expect(revealSeasonSummary(deep, 1, false).finishLabel).toBeNull();
    expect(revealSeasonSummary(deep, 1, false).champion).toBe(false);
    expect(revealSeasonSummary(deep, 2, false).finishLabel).toBeNull();
    expect(revealSeasonSummary(deep, 3, false).finishLabel).toBeNull();
    expect(revealSeasonSummary(deep, 4, false).finishLabel).toBe('Finals loss');
    expect(revealSeasonSummary(deep, 4, false).champion).toBe(false);
  });

  it('reveals a champion only when their run is complete', () => {
    const winner = fakeSeason(4, true);
    expect(revealSeasonSummary(winner, 1, false).champion).toBe(false);
    expect(revealSeasonSummary(winner, 1, false).finishLabel).toBeNull();
    expect(revealSeasonSummary(winner, 4, false).champion).toBe(true);
    expect(revealSeasonSummary(winner, 4, false).finishLabel).toBe('Champion');
    expect(revealSeasonSummary(winner, 0, true).champion).toBe(true);
    expect(revealSeasonSummary(winner, 0, true).finishLabel).toBe('Champion');
  });

  it('keeps the seed and record visible once a result exists', () => {
    const summary = revealSeasonSummary(fakeSeason(4, false), 1, false);
    expect(summary.seed).toBe(3);
    expect(summary.wins).toBe(50);
    expect(summary.losses).toBe(32);
    expect(summary.qualified).toBe(true);
  });

  it('counts one reveal per interval on the shared clock', () => {
    const start = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(revealedCount(null, 5, start)).toBe(0);
    expect(revealedCount(start, 5, start)).toBe(1);
    expect(revealedCount(start, 5, start + 4999)).toBe(1);
    expect(revealedCount(start, 5, start + 5000)).toBe(2);
    expect(revealedCount(start, 5, start + 20_000)).toBe(5);
    expect(revealedCount(start, 5, start + 600_000)).toBe(5);
  });
});
