import { describe, expect, it } from 'vitest';
import {
  LEAGUE_TEAMS,
  buildSchedule,
  rankConference,
  simulateLeague,
  stageTotals,
  type HumanTeamInput,
  type LeagueGameResult,
  type LeagueResult,
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
    const totals = stageTotals(schedule);
    expect(totals.reduce((sum, value) => sum + value, 0)).toBe(1230);
    for (const total of totals) expect(total).toBeGreaterThan(250);
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
