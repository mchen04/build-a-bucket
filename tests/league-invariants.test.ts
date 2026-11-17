import { describe, expect, it } from 'vitest';
import {
  LEAGUE_TEAMS,
  REGULAR_GAMES,
  simulateLeague,
  type HumanTeamInput,
  type LeagueGameResult,
  type LeagueResult,
  type SeriesResult,
  type TeamRecord,
} from '../src/shared/engine/league';
import { EAST, WEST } from '../src/shared/engine/rules';
import { clockFromLeague, revealLeague, stageGamesTotalFrom, stageTotalFrom } from '../src/shared/mp/league';

const SEEDS = 200;

function humans(count: number): HumanTeamInput[] {
  return LEAGUE_TEAMS.slice(0, count).map((team, index) => ({
    participantId: `p${index + 1}`,
    seat: index + 1,
    name: `Player ${index + 1}`,
    team,
    position: index % 2 === 0 ? 'guard' : 'big',
    ovr: 68 + (index % 8) * 3,
    values: Object.fromEntries(
      ['jumpShot', 'finishing', 'passing', 'handles', 'perimeterDefense', 'speed', 'bounce', 'size', 'basketballIQ', 'clutch'].map(
        (attr) => [attr, 5 + ((index + attr.length) % 5)],
      ),
    ),
  }));
}

function league(seed: string, count: number): LeagueResult {
  return simulateLeague({ seed, era: count % 3 === 0 ? 'alltime' : 'current', mode: 'normal', humans: humans(count) });
}

function conferenceTeams(conference: 'east' | 'west'): string[] {
  return conference === 'east' ? EAST : WEST;
}

function countGames(games: readonly LeagueGameResult[], team: string): { total: number; home: number; away: number; wins: number; losses: number } {
  let home = 0;
  let away = 0;
  let wins = 0;
  let losses = 0;
  for (const game of games) {
    if (game.home === team) home += 1;
    if (game.away === team) away += 1;
    if (game.home !== team && game.away !== team) continue;
    if (game.winner === team) wins += 1;
    else losses += 1;
  }
  return { total: home + away, home, away, wins, losses };
}

function h2hPct(team: string, group: readonly string[], games: readonly LeagueGameResult[]): number {
  let wins = 0;
  let losses = 0;
  for (const game of games) {
    if (!group.includes(game.home) || !group.includes(game.away)) continue;
    if (game.home === team || game.away === team) {
      if (game.winner === team) wins += 1;
      else losses += 1;
    }
  }
  return wins + losses === 0 ? 0.5 : wins / (wins + losses);
}

function confPct(record: TeamRecord): number {
  return record.confWins / Math.max(1, record.confWins + record.confLosses);
}

function checkConferenceOrder(rows: readonly TeamRecord[], games: readonly LeagueGameResult[]): void {
  const byWins = new Map<number, string[]>();
  for (const row of rows) byWins.set(row.wins, [...(byWins.get(row.wins) ?? []), row.team]);
  for (const group of byWins.values()) {
    if (group.length < 2) continue;
    const ordered = rows.filter((row) => group.includes(row.team));
    const remaining = [...group];
    for (const chosen of ordered) {
      const chosenH2h = h2hPct(chosen.team, remaining, games);
      for (const other of remaining) {
        if (other === chosen.team) continue;
        const otherH2h = h2hPct(other, remaining, games);
        expect(chosenH2h).toBeGreaterThanOrEqual(otherH2h - 1e-9);
        if (Math.abs(chosenH2h - otherH2h) < 1e-9) {
          const otherRecord = rows.find((row) => row.team === other) as TeamRecord;
          expect(confPct(chosen)).toBeGreaterThanOrEqual(confPct(otherRecord) - 1e-9);
        }
      }
      remaining.splice(remaining.indexOf(chosen.team), 1);
    }
  }
}

function checkSeries(series: SeriesResult, round: number): void {
  expect(series.round).toBe(round);
  expect(series.high).not.toBe(series.low);
  expect(series.games.length).toBeGreaterThanOrEqual(4);
  expect(series.games.length).toBeLessThanOrEqual(7);
  expect(series.games.length).toBe(series.wins + series.losses);
  expect(Math.max(series.wins, series.losses)).toBe(4);
  expect(Math.min(series.wins, series.losses)).toBeLessThanOrEqual(3);
  expect(series.winner === series.high || series.winner === series.low).toBe(true);
  expect(series.winner).toBe(series.wins === 4 ? series.high : series.low);
  expect(series.wins).toBe(series.games.filter((game) => game.winner === series.high).length);
  expect(series.losses).toBe(series.games.filter((game) => game.winner === series.low).length);
  expect(series.games[series.games.length - 1]?.winner).toBe(series.winner);
  const homePattern = ['high', 'high', 'low', 'low', 'high', 'low', 'high'];
  series.games.forEach((game, index) => {
    expect(game.index).toBe(index);
    expect(game.home).toBe(homePattern[index] === 'high' ? series.high : series.low);
    expect(game.away).toBe(homePattern[index] === 'high' ? series.low : series.high);
    expect(game.winner).toBe(game.homeScore > game.awayScore ? game.home : game.away);
  });
}

function checkPlayIn(result: LeagueResult): { east: string[]; west: string[] } {
  expect(result.playin).toHaveLength(6);
  const out: Record<'east' | 'west', string[]> = { east: [], west: [] };
  for (const conference of ['east', 'west'] as const) {
    const seeds = (conference === 'east' ? result.standings.east : result.standings.west).map((row) => row.team);
    const games = result.playin.filter((game) => game.conference === conference);
    expect(games).toHaveLength(3);
    const first = games.find((game) => game.label === '7 vs 8');
    const second = games.find((game) => game.label === '9 vs 10');
    const third = games.find((game) => game.label === 'Last spot');
    if (!first || !second || !third) throw new Error(`play-in shape missing for ${conference}`);
    expect([first.home, first.away]).toEqual([seeds[6], seeds[7]]);
    expect([second.home, second.away]).toEqual([seeds[8], seeds[9]]);
    const loser = first.winner === first.home ? first.away : first.home;
    expect(third.home).toBe(loser);
    expect(third.away).toBe(second.winner);
    expect(first.winner === seeds[6] || first.winner === seeds[7]).toBe(true);
    expect(third.winner === loser || third.winner === second.winner).toBe(true);
    out[conference] = [...seeds.slice(0, 6), first.winner, third.winner];
    expect(new Set(out[conference]).size).toBe(8);
  }
  return out;
}

function checkBracket(result: LeagueResult, playoffSeeds: Record<'east' | 'west', string[]>): void {
  const all = result.series;
  expect(all).toHaveLength(15);
  const roundCounts = [1, 2, 3, 4].map((round) => all.filter((series) => series.round === round).length);
  expect(roundCounts).toEqual([8, 4, 2, 1]);
  const winnersByRound: string[][] = [];
  for (const conference of ['east', 'west'] as const) {
    const seeds = playoffSeeds[conference];
    const seedOf = (team: string) => seeds.indexOf(team) + 1;
    const round1 = all.filter((series) => series.round === 1 && series.conference === conference);
    expect(round1).toHaveLength(4);
    const pairs = round1.map((series) => [series.high, series.low].sort());
    for (const expected of [
      [seeds[0], seeds[7]],
      [seeds[3], seeds[4]],
      [seeds[2], seeds[5]],
      [seeds[1], seeds[6]],
    ]) {
      expect(pairs).toContainEqual([...expected].sort());
    }
    for (const series of round1) {
      checkSeries(series, 1);
      expect(seedOf(series.high)).toBeLessThan(seedOf(series.low));
      expect(series.highSeed).toBe(seedOf(series.high));
      expect(series.lowSeed).toBe(seedOf(series.low));
    }
    let previous = round1;
    for (let round = 2; round <= 3; round++) {
      const next = all.filter((series) => series.round === round && series.conference === conference);
      expect(next).toHaveLength(previous.length / 2);
      next.forEach((series, index) => {
        checkSeries(series, round);
        const a = previous[index * 2] as SeriesResult;
        const b = previous[index * 2 + 1] as SeriesResult;
        expect(new Set([series.high, series.low])).toEqual(new Set([a.winner, b.winner]));
        expect(seedOf(series.high)).toBeLessThan(seedOf(series.low));
      });
      previous = next;
    }
    winnersByRound.push(previous.map((series) => series.winner));
  }
  const finals = all.filter((series) => series.round === 4);
  expect(finals).toHaveLength(1);
  const final = finals[0] as SeriesResult;
  checkSeries(final, 4);
  expect(final.conference).toBe('finals');
  expect(new Set([final.high, final.low])).toEqual(new Set(winnersByRound.flat()));
  expect(result.champion).toBe(final.winner);

  const eliminated = new Map<string, number>();
  for (const series of all) {
    const loser = series.winner === series.high ? series.low : series.high;
    eliminated.set(loser, series.round);
  }
  for (const series of all) {
    for (const team of [series.high, series.low]) {
      const out = eliminated.get(team);
      expect(out === undefined || series.round <= out).toBe(true);
    }
  }
  expect(eliminated.size).toBe(15);
  expect([...eliminated.values()].filter((round) => round === 4)).toHaveLength(1);
}

function checkHumanSeasons(result: LeagueResult, playoffSeeds: Record<'east' | 'west', string[]>): void {
  const records = new Map([...result.standings.east, ...result.standings.west].map((row) => [row.team, row]));
  const playInTeams = new Set(result.playin.flatMap((game) => [game.home, game.away]));
  const advanced = new Set(Object.values(playoffSeeds).flat());
  for (const human of result.humans) {
    const record = records.get(human.team);
    expect(record).toBeDefined();
    expect(human.wins).toBe(record?.wins ?? -1);
    expect(human.losses).toBe(record?.losses ?? -1);
    expect(human.seed).toBe(record?.seed ?? -1);
    expect(human.madePlayoffs).toBe((record?.seed ?? 15) <= 6 || advanced.has(human.team));
    expect(human.playIn).toBe(playInTeams.has(human.team));
    expect(human.champion).toBe(human.team === result.champion);
    const inPlayin = result.playin.some((game) => game.home === human.team || game.away === human.team);
    const lost = result.series.find((series) => series.winner !== human.team && (series.high === human.team || series.low === human.team));
    const expectedFinish =
      human.team === result.champion
        ? 'Champion'
        : lost
          ? lost.round === 4
            ? 'Finals loss'
            : lost.round === 3
              ? 'Conference finals'
              : lost.round === 2
                ? 'Semis'
                : 'First round'
          : inPlayin
            ? 'Play-in exit'
            : 'Missed playoffs';
    expect(human.finish).toBe(expectedFinish);
  }
  expect(result.humans.filter((human) => human.champion)).toHaveLength(result.humans.filter((human) => human.team === result.champion).length);
}

describe('many-seed league invariants', () => {
  it(`holds for ${SEEDS} seeds`, () => {
    for (let index = 0; index < SEEDS; index++) {
      const seed = `invariant-${index}`;
      const count = (index % 8) + 1;
      const result = league(seed, count);
      expect(result.seed).toBe(seed);
      expect(result.games).toHaveLength((LEAGUE_TEAMS.length * REGULAR_GAMES) / 2);

      for (const team of LEAGUE_TEAMS) {
        const counts = countGames(result.games, team);
        expect(counts.total, `${seed} ${team} games`).toBe(REGULAR_GAMES);
        expect(counts.home, `${seed} ${team} home`).toBe(REGULAR_GAMES / 2);
        expect(counts.away, `${seed} ${team} away`).toBe(REGULAR_GAMES / 2);
        expect(counts.wins + counts.losses).toBe(REGULAR_GAMES);
      }
      expect(result.games.reduce((sum, game) => sum + (game.winner === game.home ? 1 : 0), 0)).toBeGreaterThan(0);
      for (const game of result.games) {
        expect(game.home).not.toBe(game.away);
        expect(LEAGUE_TEAMS.indexOf(game.home)).toBeGreaterThanOrEqual(0);
        expect(LEAGUE_TEAMS.indexOf(game.away)).toBeGreaterThanOrEqual(0);
        expect(game.winner).toBe(game.homeScore > game.awayScore ? game.home : game.away);
      }

      expect(result.standings.east).toHaveLength(15);
      expect(result.standings.west).toHaveLength(15);
      for (const conference of ['east', 'west'] as const) {
        const rows = conference === 'east' ? result.standings.east : result.standings.west;
        rows.forEach((row, position) => {
          expect(conferenceTeams(conference)).toContain(row.team);
          expect(row.conference).toBe(conference);
          expect(row.seed).toBe(position + 1);
          const counts = countGames(result.games, row.team);
          expect(row.wins).toBe(counts.wins);
          expect(row.losses).toBe(counts.losses);
          expect(row.wins + row.losses).toBe(REGULAR_GAMES);
        });
        for (let position = 1; position < rows.length; position++) {
          expect((rows[position - 1] as TeamRecord).wins).toBeGreaterThanOrEqual((rows[position] as TeamRecord).wins);
        }
        checkConferenceOrder(rows, result.games);
      }
      const eastWins = result.standings.east.reduce((sum, row) => sum + row.wins, 0);
      const westWins = result.standings.west.reduce((sum, row) => sum + row.wins, 0);
      expect(eastWins + westWins).toBe(result.games.length);

      const playoffSeeds = checkPlayIn(result);
      checkBracket(result, playoffSeeds);
      checkHumanSeasons(result, playoffSeeds);

      const clock = clockFromLeague(result);
      expect(clock.counts).toEqual([1230, 0, 0, 0]);
      expect(clock.playin).toBe(6);
      expect(clock.seriesCounts).toEqual([8, 4, 2, 1]);
      expect(clock.seriesGames.reduce((sum, value) => sum + value, 0)).toBe(result.series.reduce((sum, series) => sum + series.games.length, 0));
    }
  }, 120_000);
});

describe('reveal and stage machinery', () => {
  const result = league('reveal-invariants', 8);
  const clock = clockFromLeague(result);
  const me = result.humans[0]?.participantId ?? null;

  it('reaches its checkpoint on every stage and never shows a later stage', () => {
    for (let stage = 0; stage <= 10; stage++) {
      const total = stageGamesTotalFrom(clock, stage);
      const view = revealLeague(result, stage, total, me);
      expect(view.checkpoint).toBe(true);
      expect(view.stage).toBe(stage);
      if (stage === 0) expect(view.cursor).toBe(1230);
      if (stage >= 1 && stage <= 3) expect(view.cursor).toBe(0);
      if (stage === 5) expect(view.cursor).toBe(6);
      if (stage >= 6 && stage <= 9) {
        expect(view.cursor).toBe(total);
        expect(view.playoffs?.every((series) => series.round < stage - 5 || (series.round === stage - 5 && series.complete))).toBe(true);
      }
      if (stage === 10) expect(view.recap?.champion).toBe(result.champion);
      expect(view.standings?.every((row) => (stage >= 4 ? row.seed !== null : row.seed === null))).toBe(true);
      expect(view.awards !== null).toBe(stage >= 4);
      expect(view.playin !== null).toBe(stage >= 5);
      expect(view.playoffs !== null).toBe(stage >= 6);
      expect(view.recap !== null).toBe(stage >= 10);
    }
  });

  it('keeps the fixed playoff denominator while a checkpoint reveals fewer games', () => {
    for (let stage = 6; stage <= 9; stage++) {
      expect(stageTotalFrom(clock, stage)).toBe(7 * (clock.seriesCounts[stage - 6] ?? 0));
      expect(stageGamesTotalFrom(clock, stage)).toBeLessThanOrEqual(stageTotalFrom(clock, stage));
    }
  });

  it.fails('makes a playoff checkpoint reach its stageTotal', () => {
    for (let stage = 6; stage <= 9; stage++) {
      const view = revealLeague(result, stage, stageGamesTotalFrom(clock, stage), me);
      expect(view.checkpoint).toBe(true);
      expect(view.cursor).toBe(view.stageTotal);
    }
  });
});

describe('finals home court', () => {
  function findFinalsMismatch(): { result: LeagueResult; final: SeriesResult; better: string; worse: string } | null {
    for (let index = 0; index < 600; index++) {
      const result = league(`finals-record-${index}`, 2);
      const final = result.series.find((series) => series.round === 4);
      if (!final) continue;
      const records = new Map([...result.standings.east, ...result.standings.west].map((row) => [row.team, row]));
      const high = records.get(final.high);
      const low = records.get(final.low);
      if (!high || !low || high.wins === low.wins) continue;
      const better = high.wins > low.wins ? final.high : final.low;
      if (better === final.high) continue;
      return { result, final, better, worse: better === final.high ? final.low : final.high };
    }
    return null;
  }

  it('finds a finals where the better record did not hold the higher seed', () => {
    const found = findFinalsMismatch();
    expect(found).not.toBeNull();
    if (found) expect(found.final.high).not.toBe(found.better);
  });

  it.fails('gives finals home court to the better regular-season record', () => {
    const found = findFinalsMismatch();
    if (!found) throw new Error('no finals record mismatch in 600 seeds');
    const first = found.final.games[0];
    expect(first?.home).toBe(found.better);
  });
});
