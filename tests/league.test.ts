import { describe, expect, it } from 'vitest';
import {
  LEAGUE_TEAMS,
  buildSchedule,
  nextRoundSeries,
  rankConference,
  simulateLeague,
  stageTotals,
  teamWinProbability,
  type HumanTeamInput,
  type LeagueGameResult,
  type LeagueResult,
  type SeriesResult,
  type TeamRecord,
} from '../src/shared/engine/league';
import { revealLeague, stageTotal } from '../src/shared/mp/league';

function humans(count = 8): HumanTeamInput[] {
  return LEAGUE_TEAMS.slice(0, count).map((team, index) => ({
    participantId: `p${index + 1}`,
    seat: index + 1,
    name: `Player ${index + 1}`,
    team,
    position: index % 2 === 0 ? 'guard' : 'big',
    ovr: 70 + index * 3,
    values: Object.fromEntries(
      ['jumpShot', 'finishing', 'passing', 'handles', 'perimeterDefense', 'speed', 'bounce', 'size', 'basketballIQ', 'clutch'].map(
        (attr) => [attr, 6 + (index % 4)],
      ),
    ),
  }));
}

function league(seed = 'league-test'): LeagueResult {
  return simulateLeague({ seed, era: 'current', mode: 'normal', humans: humans() });
}

describe('shared league schedule', () => {
  it('gives every team exactly 82 games and a symmetric home/away split', () => {
    const schedule = buildSchedule('schedule-test');
    const counts = new Map<string, number>();
    const home = new Map<string, number>();
    const away = new Map<string, number>();
    for (const game of schedule) {
      counts.set(game.home, (counts.get(game.home) ?? 0) + 1);
      counts.set(game.away, (counts.get(game.away) ?? 0) + 1);
      home.set(game.home, (home.get(game.home) ?? 0) + 1);
      away.set(game.away, (away.get(game.away) ?? 0) + 1);
    }
    expect(schedule).toHaveLength(1230);
    expect(new Set(schedule.map((game) => game.gameNo)).size).toBe(1230);
    for (const team of LEAGUE_TEAMS) {
      expect(counts.get(team)).toBe(82);
      expect(home.get(team)).toBe(away.get(team));
    }
    expect(stageTotals(schedule)).toEqual([1230, 0, 0, 0]);
  });

  it('is deterministic for the same seed and different for another seed', () => {
    expect(buildSchedule('a')).toEqual(buildSchedule('a'));
    expect(buildSchedule('a')).not.toEqual(buildSchedule('b'));
  });
});

describe('shared league simulation', () => {
  it('is deterministic and stores one result per matchup', () => {
    const first = league();
    const second = league();
    expect(first.games).toEqual(second.games);
    expect(first.games).toHaveLength(1230);
    expect(new Set(first.games.map((game) => game.gameNo)).size).toBe(1230);
    expect(first.standings.east).toHaveLength(15);
    expect(first.standings.west).toHaveLength(15);
    expect(first.series).toHaveLength(15);
    expect(first.champion).toBe(first.series[first.series.length - 1]?.winner);
  });

  it('gives both participants the same human-vs-human result', () => {
    const result = league();
    const a = result.humans[0]!;
    const b = result.humans[1]!;
    const games = result.games.filter(
      (game) => (game.home === a.team && game.away === b.team) || (game.home === b.team && game.away === a.team),
    );
    expect(games.length).toBeGreaterThan(0);
    const viewA = revealLeague(result, 3, stageTotal(result, 3), a.participantId);
    const viewB = revealLeague(result, 3, stageTotal(result, 3), b.participantId);
    for (const game of games) {
      const fromA = viewA.games.find((entry) => entry.gameNo === game.gameNo);
      const fromB = viewB.games.find((entry) => entry.gameNo === game.gameNo);
      expect(fromA).toEqual(fromB);
    }
  });

  it('never reveals a result, seed, award, play-in, playoff or champion beyond the cursor', () => {
    const result = league();
    const empty = revealLeague(result, 0, 0, 'p1');
    expect(empty.games).toHaveLength(0);
    expect(empty.standings?.every((row) => row.wins === 0 && row.losses === 0 && row.seed === null)).toBe(true);
    expect(empty.awards).toBeNull();
    expect(empty.playin).toBeNull();
    expect(empty.playoffs).toBeNull();
    expect(empty.recap).toBeNull();
    expect(empty.my?.seed).toBeNull();
    expect(empty.my?.finish).toBeNull();

    const early = revealLeague(result, 0, 10, 'p1');
    expect(early.games.every((game) => game.gameNo <= 10)).toBe(true);
    expect(early.awards).toBeNull();
    expect(early.playoffs).toBeNull();

    const awards = revealLeague(result, 4, 0, 'p1');
    expect(awards.awards).not.toBeNull();
    expect(awards.standings?.every((row) => row.seed !== null)).toBe(true);
    expect(awards.playin).toBeNull();
    expect(awards.playoffs).toBeNull();
    expect(awards.recap).toBeNull();

    const playin = revealLeague(result, 5, 0, 'p1');
    expect(playin.playin).not.toBeNull();
    expect(playin.playoffs).toBeNull();

    const roundOne = revealLeague(result, 6, 0, 'p1');
    expect(roundOne.playoffs).not.toBeNull();
    expect(roundOne.playoffs?.every((series) => series.games.length === 0 && series.winner === null)).toBe(true);
    expect(roundOne.recap).toBeNull();

    const recap = revealLeague(result, 10, 0, 'p1');
    expect(recap.recap?.champion).toBe(result.champion);
    expect(recap.my?.finish).not.toBeNull();
  });

  it('keeps seeds, play-in and the bracket consistent for every participant', () => {
    const result = league();
    const views = result.humans.map((human) => revealLeague(result, 10, 0, human.participantId));
    const first = views[0]!;
    const shared = (rows: typeof first.standings) => rows?.map((row) => ({ ...row, isMine: false }));
    for (const view of views.slice(1)) {
      expect(shared(view.standings)).toEqual(shared(first.standings));
      expect(view.playin).toEqual(first.playin);
      expect(view.playoffs).toEqual(first.playoffs);
      expect(view.recap).toEqual(first.recap);
    }
    const eastSeeds = result.standings.east.map((row) => row.seed);
    expect(eastSeeds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const playoffTeams = new Set(result.series.filter((series) => series.round === 1).flatMap((series) => [series.high, series.low]));
    expect(playoffTeams.size).toBe(16);
    expect(result.playin).toHaveLength(6);
  });

  it('orders standings by wins and breaks ties deterministically', () => {
    const result = league();
    for (const conference of [result.standings.east, result.standings.west]) {
      for (let index = 1; index < conference.length; index++) {
        expect((conference[index - 1]!.wins)).toBeGreaterThanOrEqual(conference[index]!.wins);
      }
    }
    expect(league().standings).toEqual(result.standings);
  });
});

function record(team: string, wins: number, confWins: number, confLosses: number): TeamRecord {
  return {
    team,
    conference: 'east',
    wins,
    losses: 82 - wins,
    confWins,
    confLosses,
    pointsFor: 0,
    pointsAgainst: 0,
    seed: null,
  };
}

function game(gameNo: number, home: string, away: string, winner: string): LeagueGameResult {
  return {
    gameNo,
    round: 1,
    stage: 0,
    home,
    away,
    homeScore: winner === home ? 110 : 100,
    awayScore: winner === away ? 110 : 100,
    winner,
  };
}

describe('conference tiebreakers', () => {
  it('breaks a wins tie with head-to-head', () => {
    const records = new Map([
      ['AAA', record('AAA', 41, 25, 15)],
      ['BBB', record('BBB', 41, 25, 15)],
      ['CCC', record('CCC', 40, 24, 16)],
    ]);
    const games = [
      game(1, 'AAA', 'BBB', 'AAA'),
      game(2, 'BBB', 'AAA', 'AAA'),
      game(3, 'AAA', 'BBB', 'AAA'),
      game(4, 'BBB', 'AAA', 'BBB'),
    ];
    const order = rankConference(['AAA', 'BBB', 'CCC'], records, games, 'tie-seed');
    expect(order.map((row) => row.team)).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('breaks an even head-to-head tie with conference record', () => {
    const records = new Map([
      ['AAA', record('AAA', 41, 30, 10)],
      ['BBB', record('BBB', 41, 25, 15)],
    ]);
    const games = [
      game(1, 'AAA', 'BBB', 'AAA'),
      game(2, 'BBB', 'AAA', 'AAA'),
      game(3, 'AAA', 'BBB', 'BBB'),
      game(4, 'BBB', 'AAA', 'BBB'),
    ];
    const order = rankConference(['AAA', 'BBB'], records, games, 'tie-seed');
    expect(order.map((row) => row.team)).toEqual(['AAA', 'BBB']);
  });

  it('uses a deterministic seeded coin when everything else is equal', () => {
    const records = new Map([
      ['AAA', record('AAA', 41, 25, 15)],
      ['BBB', record('BBB', 41, 25, 15)],
    ]);
    const games = [
      game(1, 'AAA', 'BBB', 'AAA'),
      game(2, 'BBB', 'AAA', 'AAA'),
      game(3, 'AAA', 'BBB', 'BBB'),
      game(4, 'BBB', 'AAA', 'BBB'),
    ];
    const first = rankConference(['AAA', 'BBB'], records, games, 'coin-seed').map((row) => row.team);
    const second = rankConference(['AAA', 'BBB'], records, games, 'coin-seed').map((row) => row.team);
    expect(first).toEqual(second);
    expect([['AAA', 'BBB'], ['BBB', 'AAA']]).toContainEqual(first);
  });
});

function series(id: string, high: string, low: string, highSeed: number, lowSeed: number, winner: string): SeriesResult {
  return {
    id,
    round: 1,
    name: 'First Round',
    conference: 'east',
    high,
    low,
    highSeed,
    lowSeed,
    games: [],
    winner,
    wins: 4,
    losses: 0,
  };
}

describe('multi-team tiebreakers', () => {
  it('orders a three-way head-to-head cycle by conference record', () => {
    const records = new Map([
      ['AAA', record('AAA', 41, 20, 20)],
      ['BBB', record('BBB', 41, 25, 15)],
      ['CCC', record('CCC', 41, 30, 10)],
    ]);
    const games = [
      game(1, 'AAA', 'BBB', 'AAA'),
      game(2, 'BBB', 'AAA', 'BBB'),
      game(3, 'BBB', 'CCC', 'BBB'),
      game(4, 'CCC', 'BBB', 'CCC'),
      game(5, 'CCC', 'AAA', 'CCC'),
      game(6, 'AAA', 'CCC', 'AAA'),
    ];
    const order = rankConference(['AAA', 'BBB', 'CCC'], records, games, 'cycle-seed');
    expect(order.map((row) => row.team)).toEqual(['CCC', 'BBB', 'AAA']);
    expect(rankConference(['AAA', 'BBB', 'CCC'], records, games, 'cycle-seed')).toEqual(order);
  });

  it('lifts the team that swept the tied group before falling back to conference record', () => {
    const records = new Map([
      ['AAA', record('AAA', 41, 20, 20)],
      ['BBB', record('BBB', 41, 30, 10)],
      ['CCC', record('CCC', 41, 25, 15)],
    ]);
    const games = [
      game(1, 'AAA', 'BBB', 'AAA'),
      game(2, 'BBB', 'AAA', 'AAA'),
      game(3, 'AAA', 'CCC', 'AAA'),
      game(4, 'CCC', 'AAA', 'AAA'),
      game(5, 'BBB', 'CCC', 'BBB'),
      game(6, 'CCC', 'BBB', 'CCC'),
    ];
    const order = rankConference(['AAA', 'BBB', 'CCC'], records, games, 'sweep-seed');
    expect(order.map((row) => row.team)).toEqual(['AAA', 'BBB', 'CCC']);
  });
});

describe('bracket reseeding', () => {
  it('uses the winner seed, not the bracket slot, in the next round', () => {
    const seeds = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const first = [
      series('e-r1-1', 'A', 'H', 1, 8, 'H'),
      series('e-r1-2', 'D', 'E', 4, 5, 'D'),
      series('e-r1-3', 'C', 'F', 3, 6, 'C'),
      series('e-r1-4', 'B', 'G', 2, 7, 'B'),
    ];
    const second = nextRoundSeries(2, 'east', first, seeds, new Map(), 'current', 'reseed');
    expect(second[0]?.high).toBe('D');
    expect(second[0]?.low).toBe('H');
    expect(second[0]?.highSeed).toBe(4);
    expect(second[0]?.lowSeed).toBe(8);
    expect(second[1]?.high).toBe('B');
    expect(second[1]?.low).toBe('C');
  });
});

describe('one strength scale', () => {
  it('treats a computer team as a neutral human on the same team', () => {
    const neutral: HumanTeamInput[] = [
      {
        participantId: 'p1',
        seat: 1,
        name: 'Neutral',
        team: 'BOS',
        position: 'guard',
        ovr: 82,
        values: {},
      },
    ];
    expect(teamWinProbability('BOS', neutral, 'current')).toBeCloseTo(teamWinProbability('BOS', [], 'current'), 10);
    expect(teamWinProbability('BOS', neutral, 'alltime')).toBeCloseTo(teamWinProbability('BOS', [], 'alltime'), 10);
  });

  it('moves a human up and down the same scale as the computer teams', () => {
    const base = teamWinProbability('BOS', [], 'current');
    const strong = teamWinProbability('BOS', [{ participantId: 'p1', seat: 1, name: 'S', team: 'BOS', position: 'guard', ovr: 95, values: {} }], 'current');
    const weak = teamWinProbability('BOS', [{ participantId: 'p1', seat: 1, name: 'W', team: 'BOS', position: 'guard', ovr: 60, values: {} }], 'current');
    expect(strong).toBeGreaterThan(base);
    expect(weak).toBeLessThan(base);
    expect(strong).toBeLessThanOrEqual(0.87);
    expect(weak).toBeGreaterThanOrEqual(0.12);
  });
});
