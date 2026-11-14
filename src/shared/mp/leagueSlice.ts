import {
  LEAGUE_TEAMS,
  type HeadToHead,
  type HumanSeason,
  type LeagueAward,
  type LeagueGameResult,
  type LeagueResult,
  type PlayInGame,
  type SeriesResult,
  type TeamRecord,
} from '../engine/league.js';
import { EAST } from '../engine/rules.js';
import { clockFromLeague, type LeagueClock, type RevealData } from './league.js';

export interface LeagueSliceMeta {
  humans: HumanSeason[];
  east: [number, number, number, number | null][];
  west: [number, number, number, number | null][];
  clock: LeagueClock;
  awards: { mvp: LeagueAward; dpoy: LeagueAward } | null;
  playin: PlayInGame[] | null;
  series: SeriesResult[] | null;
  champion: string | null;
  h2h: Record<string, Record<string, HeadToHead>> | null;
}

export interface LeagueSliceGame {
  gameNo: number;
  stage: number;
  home: number;
  away: number;
  homeScore: number;
  awayScore: number;
  winner: number;
  friends: boolean;
}

export interface LeagueSliceCheckpoint {
  stage: number;
  cursor: number;
  visible: number;
  records: number[];
}

export interface LeagueSlice {
  meta: LeagueSliceMeta;
  games: LeagueSliceGame[];
  checkpoints: LeagueSliceCheckpoint[];
}

function teamIndex(team: string): number {
  return LEAGUE_TEAMS.indexOf(team);
}

export function buildLeagueSlice(league: LeagueResult): LeagueSlice {
  const humanTeams = new Set(league.humans.map((entry) => entry.team));
  const games: LeagueSliceGame[] = league.games.map((game) => ({
    gameNo: game.gameNo,
    stage: game.stage,
    home: teamIndex(game.home),
    away: teamIndex(game.away),
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    winner: teamIndex(game.winner),
    friends: humanTeams.has(game.home) && humanTeams.has(game.away),
  }));
  const clock = clockFromLeague(league);
  const meta: LeagueSliceMeta = {
    humans: league.humans,
    east: league.standings.east.map((row) => [teamIndex(row.team), row.wins, row.losses, row.seed]),
    west: league.standings.west.map((row) => [teamIndex(row.team), row.wins, row.losses, row.seed]),
    clock,
    awards: league.awards,
    playin: league.playin,
    series: league.series,
    champion: league.champion,
    h2h: league.h2h,
  };
  const checkpoints: LeagueSliceCheckpoint[] = [];
  for (let stage = 0; stage <= 3; stage++) {
    const total = clock.counts[stage] ?? 0;
    const prefix = clock.counts.slice(0, stage).reduce((sum, count) => sum + count, 0);
    const records = new Map<string, { wins: number; losses: number; conference: 'east' | 'west' }>();
    for (const row of league.standings.east) records.set(row.team, { wins: 0, losses: 0, conference: 'east' });
    for (const row of league.standings.west) records.set(row.team, { wins: 0, losses: 0, conference: 'west' });
    const apply = (game: LeagueGameResult) => {
      const home = records.get(game.home);
      const away = records.get(game.away);
      if (!home || !away) return;
      if (game.winner === game.home) {
        home.wins += 1;
        away.losses += 1;
      } else {
        away.wins += 1;
        home.losses += 1;
      }
      records.set(game.home, home);
      records.set(game.away, away);
    };
    for (let index = 0; index < prefix; index++) {
      const game = league.games[index];
      if (game) apply(game);
    }
    for (let cursor = 0; cursor <= total; cursor++) {
      if (cursor > 0) {
        const game = league.games[prefix + cursor - 1];
        if (game) apply(game);
      }
      const sorted = [...records.entries()].sort(
        (a, b) => b[1].wins - a[1].wins || a[1].losses - b[1].losses || a[0].localeCompare(b[0]),
      );
      checkpoints.push({
        stage,
        cursor,
        visible: prefix + cursor,
        records: sorted.flatMap(([team, record]) => [teamIndex(team), record.wins, record.losses]),
      });
    }
  }
  return { meta, games, checkpoints };
}

function teamRecord(row: [number, number, number, number | null], conference: 'east' | 'west'): TeamRecord {
  return {
    team: LEAGUE_TEAMS[row[0]] ?? '',
    conference,
    wins: row[1],
    losses: row[2],
    confWins: 0,
    confLosses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    seed: row[3],
  };
}

export function revealDataFromSlice(
  meta: LeagueSliceMeta,
  games: LeagueSliceGame[],
  checkpoint: LeagueSliceCheckpoint | null,
  stage: number,
): RevealData {
  const clock = meta.clock;
  const gamesTotal = clock.counts.reduce((sum, count) => sum + count, 0);
  return {
    games: games.map((game) => ({
      gameNo: game.gameNo,
      round: 0,
      stage: game.stage,
      home: LEAGUE_TEAMS[game.home] ?? '',
      away: LEAGUE_TEAMS[game.away] ?? '',
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      winner: LEAGUE_TEAMS[game.winner] ?? '',
    })),
    gamesTotal,
    stageCounts: clock.counts,
    playinCount: clock.playin,
    seriesCounts: clock.seriesCounts,
    seriesGames: clock.seriesGames,
    standings:
      stage >= 4
        ? {
            east: meta.east.map((row) => teamRecord(row, 'east')),
            west: meta.west.map((row) => teamRecord(row, 'west')),
          }
        : null,
    partial:
      stage < 4 && checkpoint
        ? {
            visible: checkpoint.visible,
            records: Array.from({ length: Math.floor(checkpoint.records.length / 3) }, (_, index) => {
              const team = checkpoint.records[index * 3] ?? 0;
              return {
                team: LEAGUE_TEAMS[team] ?? '',
                conference: team < EAST.length ? ('east' as const) : ('west' as const),
                wins: checkpoint.records[index * 3 + 1] ?? 0,
                losses: checkpoint.records[index * 3 + 2] ?? 0,
              };
            }),
          }
        : null,
    humans: meta.humans,
    awards: stage >= 4 ? meta.awards : null,
    playin: stage >= 5 ? meta.playin : null,
    series: stage >= 6 ? meta.series : null,
    champion: stage >= 10 ? meta.champion : null,
    h2h: stage >= 10 ? meta.h2h : null,
  };
}
