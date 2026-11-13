import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/shared/engine/rng';
import { simulateSeason } from '../src/shared/engine/season';
import type { Build, PlayInRound, SeasonResult, SeriesRound } from '../src/shared/engine/types';
import { BIG_KEYS, GUARD_KEYS, picksFor } from './fixtures/pool';

function build(position: 'guard' | 'big', era: 'current' | 'alltime', value: number): Build {
  const keys = position === 'guard' ? GUARD_KEYS : BIG_KEYS;
  const values = Object.fromEntries(keys.map((key) => [key, value]));
  return { position, era, picks: picksFor(keys, values) };
}

function run(seed: number, team: string, position: 'guard' | 'big' = 'guard'): SeasonResult {
  return simulateSeason({
    build: build(position, 'current', 6),
    team,
    playerName: 'You',
    rng: mulberry32(seed),
    displayRng: mulberry32(seed + 99991),
  });
}

const seeds = Array.from({ length: 60 }, (_, index) => index * 7919 + 13);
const teams = ['MIA', 'LAL', 'OKC', 'BOS', 'SAS', 'DEN'];

describe('simulateSeason', () => {
  it('plays 82 games and keeps wins and losses consistent', () => {
    for (const [index, seed] of seeds.entries()) {
      const result = run(seed, teams[index % teams.length] as string);
      expect(result.games).toHaveLength(82);
      expect(result.gameLog).toHaveLength(82);
      expect(result.wins + result.losses).toBe(82);
      expect(result.wins).toBe(result.gameLog.filter((entry) => entry === 'W').length);
      expect(result.games.filter((game) => game.won)).toHaveLength(result.wins);
      expect(result.games.map((game) => game.g)).toEqual(Array.from({ length: 82 }, (_, i) => i + 1));
    }
  });

  it('keeps the opponent list to the other 29 teams', () => {
    for (const [index, seed] of seeds.entries()) {
      const team = teams[index % teams.length] as string;
      const result = run(seed, team);
      const opponents = new Set(result.games.map((game) => game.opponent));
      expect(opponents.has(team)).toBe(false);
      expect(opponents.size).toBeLessThanOrEqual(29);
    }
  });

  it('gives every game a consistent score line', () => {
    for (const seed of seeds.slice(0, 20)) {
      const result = run(seed, 'MIA');
      for (const game of result.games) {
        const [winner, loser] = game.won ? [game.mySc, game.oppSc] : [game.oppSc, game.mySc];
        expect(winner - loser).toBeGreaterThanOrEqual(3);
        expect(winner - loser).toBeLessThanOrEqual(19);
        expect(loser).toBeGreaterThanOrEqual(94);
        expect(winner).toBeLessThanOrEqual(94 + 21 + 19);
      }
    }
  });

  it('builds a 15 team conference table with the user ranked and seeded', () => {
    for (const [index, seed] of seeds.entries()) {
      const team = teams[index % teams.length] as string;
      const result = run(seed, team);
      expect(result.standings).toHaveLength(15);
      const wins = result.standings.map((row) => row.wins);
      const sorted = [...wins].sort((a, b) => b - a);
      expect(wins).toEqual(sorted);
      const us = result.standings.filter((row) => row.isUs);
      expect(us).toHaveLength(1);
      expect(us[0]?.short).toBe(team);
      expect(result.seed).toBe(result.standings.findIndex((row) => row.isUs) + 1);
      expect(result.seed).toBeGreaterThanOrEqual(1);
      expect(result.seed).toBeLessThanOrEqual(15);
      expect(result.conference).toBe(['MIA', 'BOS'].includes(team) ? 'east' : 'west');
      const ties = result.standings.filter((row) => row.wins === result.wins);
      expect(ties[0]?.isUs).toBe(true);
    }
  });

  it('only reaches the playoffs from seed 10 or better', () => {
    for (const [index, seed] of seeds.entries()) {
      const result = run(seed, teams[index % teams.length] as string);
      if (result.seed > 10) {
        expect(result.playoffRounds).toEqual([]);
        expect(result.madePlayoffs).toBe(false);
        expect(result.champion).toBe(false);
        expect(result.finalsOpp).toBeNull();
      } else {
        expect(result.playoffRounds.length).toBeGreaterThan(0);
      }
    }
  });

  it('uses the play-in rule for seeds 7 to 10', () => {
    for (const seed of seeds) {
      const result = run(seed, 'MIA');
      const playIn = result.playoffRounds.find((round): round is PlayInRound => round.type === 'playin');
      if (result.seed >= 7 && result.seed <= 10) {
        expect(playIn).toBeDefined();
        expect(result.madePlayoffs).toBe(playIn?.advanced === true);
        if (playIn && !playIn.advanced) expect(result.champion).toBe(false);
      } else {
        expect(playIn).toBeUndefined();
        if (result.seed <= 6) expect(result.madePlayoffs).toBe(true);
      }
    }
  });

  it('progresses the bracket one winning series at a time', () => {
    const names = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'];
    for (const seed of seeds) {
      const result = run(seed, 'LAL');
      const series = result.playoffRounds.filter((round): round is SeriesRound => round.type === 'series');
      expect(series.length).toBeLessThanOrEqual(4);
      series.forEach((round, index) => {
        expect(round.name).toBe(names[index]);
        expect(round.roundIndex).toBe(index);
        expect(round.wins + round.losses).toBeGreaterThanOrEqual(4);
        expect(Math.max(round.wins, round.losses)).toBe(4);
        expect(round.games).toHaveLength(round.wins + round.losses);
        expect(round.won).toBe(round.wins === 4);
      });
      const firstLoss = series.findIndex((round) => !round.won);
      if (firstLoss >= 0) expect(series.length).toBe(firstLoss + 1);
      expect(result.champion).toBe(series.length === 4 && series.every((round) => round.won));
      expect(result.finalsOpp).toBe(series.length === 4 ? series[3]?.opponent.short : null);
    }
  });

  it('produces plausible season averages and awards', () => {
    for (const seed of seeds) {
      const result = run(seed, 'BOS');
      expect(result.ppg).toBeGreaterThanOrEqual(4);
      expect(result.ppg).toBeLessThanOrEqual(60);
      expect(result.rpg).toBeGreaterThanOrEqual(1.5);
      expect(result.apg).toBeGreaterThanOrEqual(1);
      expect(result.spg).toBeGreaterThanOrEqual(0.2);
      expect(result.bpg).toBeGreaterThanOrEqual(0);
      expect(result.tov).toBeGreaterThanOrEqual(0.5);
      expect(result.tov).toBeLessThanOrEqual(5.5);
      expect(result.fgPct).toBeGreaterThanOrEqual(38);
      expect(result.fgPct).toBeLessThanOrEqual(53);
      expect(result.threePct).toBeGreaterThanOrEqual(0);
      expect(result.threePct).toBeLessThanOrEqual(45);
      expect(result.ftPct).toBeGreaterThanOrEqual(52);
      expect(result.ftPct).toBeLessThanOrEqual(99);
      expect(result.displayMvp.name.length).toBeGreaterThan(0);
      expect(result.displayDpoy.name.length).toBeGreaterThan(0);
      if (result.goatRank !== null) {
        expect(result.goatRank).toBeGreaterThanOrEqual(1);
        expect(result.goatRank).toBeLessThanOrEqual(75);
      }
      if (result.ovr < 92) expect(result.goatRank).toBeNull();
      if (result.displayDpoy.isPlayer) {
        expect(result.ovr).toBeGreaterThanOrEqual(80);
        expect(result.bpg).toBeGreaterThanOrEqual(2.8);
        expect(result.spg).toBeGreaterThanOrEqual(1.5);
      }
      if (result.dpoy) expect(result.mvp).toBe(false);
      if (result.mvp) expect(result.madePlayoffs).toBe(true);
    }
  });

  it('picks the first game with the most points as the best game', () => {
    for (const seed of seeds.slice(0, 20)) {
      const result = run(seed, 'DEN');
      const max = Math.max(...result.games.map((game) => game.pts));
      expect(result.bestGame?.pts).toBe(max);
      expect(result.games.find((game) => game.pts === max)?.g).toBe(result.bestGame?.g);
    }
  });

  it('is deterministic for the same seeds', () => {
    const first = run(4242, 'MIA');
    const second = run(4242, 'MIA');
    expect(second).toEqual(first);
  });

  it('runs for both positions and eras', () => {
    for (const position of ['guard', 'big'] as const) {
      for (const era of ['current', 'alltime'] as const) {
        const result = simulateSeason({
          build: build(position, era, 8),
          team: 'MIA',
          playerName: 'You',
          rng: mulberry32(99),
          displayRng: mulberry32(98),
        });
        expect(result.wins + result.losses).toBe(82);
        expect(result.position).toBe(position);
        expect(result.standings).toHaveLength(15);
      }
    }
  });
});
