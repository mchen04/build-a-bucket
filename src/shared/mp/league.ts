import type { LeagueResult, SeriesResult } from '../engine/league.js';
import { stageTotals } from '../engine/league.js';

export const STAGE_COUNT = 11;
export const STAGE_NAMES = [
  'First quarter',
  'Second quarter',
  'Third quarter',
  'Fourth quarter',
  'Awards and standings',
  'Play-In',
  'First Round',
  'Conference Semifinals',
  'Conference Finals',
  'NBA Finals',
  'Recap',
];
export const REGULAR_BATCH_SIZE = 3;
export const REGULAR_BATCH_MS = 1200;
export const PLAYOFF_GAME_MS = 1500;

export function stagePhase(stage: number): 'season' | 'awards' | 'playin' | 'playoffs' | 'recap' {
  if (stage <= 3) return 'season';
  if (stage === 4) return 'awards';
  if (stage === 5) return 'playin';
  if (stage <= 9) return 'playoffs';
  return 'recap';
}

export function stageGamesTotal(league: LeagueResult, stage: number): number {
  if (stage <= 3) return stageTotals(league.games)[stage] ?? 0;
  if (stage === 5) return league.playin.length;
  if (stage >= 6 && stage <= 9) {
    return league.series.filter((entry) => entry.round === stage - 5).reduce((sum, entry) => sum + entry.games.length, 0);
  }
  return 0;
}

export function stageTotal(league: LeagueResult, stage: number): number {
  if (stage <= 3) return stageTotals(league.games)[stage] ?? 0;
  if (stage === 5) return 6;
  if (stage >= 6 && stage <= 9) return 7 * league.series.filter((entry) => entry.round === stage - 5).length;
  return 0;
}

export function stageCursorAt(league: LeagueResult, stage: number, startedAt: number | null, now: number): number {
  const total = stageGamesTotal(league, stage);
  if (total === 0) return 0;
  if (startedAt === null) return 0;
  const elapsed = Math.max(0, now - startedAt);
  if (stage <= 3) {
    return Math.min(total, Math.floor(elapsed / REGULAR_BATCH_MS) * REGULAR_BATCH_SIZE);
  }
  if (stage >= 6 && stage <= 9) {
    return Math.min(total, Math.floor(elapsed / PLAYOFF_GAME_MS));
  }
  return total;
}

export function isCheckpoint(cursor: number, total: number): boolean {
  return cursor >= total;
}

export interface LeagueGameView {
  gameNo: number;
  stage: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  winner: string;
  mine: boolean;
  friends: boolean;
}

export interface StandingView {
  team: string;
  conference: 'east' | 'west';
  wins: number;
  losses: number;
  seed: number | null;
  isMine: boolean;
  humanName: string | null;
}

export interface SeriesGameView {
  index: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  winner: string;
}

export interface SeriesView {
  id: string;
  round: number;
  name: string;
  conference: 'east' | 'west' | 'finals';
  high: string;
  low: string;
  highSeed: number;
  lowSeed: number;
  games: SeriesGameView[];
  winner: string | null;
  wins: number;
  losses: number;
  complete: boolean;
}

export interface PlayInView {
  id: string;
  conference: 'east' | 'west';
  label: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  winner: string;
}

export interface AwardView {
  name: string;
  team: string;
  mine: boolean;
  ppg?: number;
  rpg?: number;
  apg?: number;
  spg?: number;
  bpg?: number;
}

export interface MyLeagueView {
  team: string;
  wins: number;
  losses: number;
  seed: number | null;
  madePlayoffs: boolean | null;
  finish: string | null;
  champion: boolean | null;
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
  spg: number | null;
  bpg: number | null;
  mvp: boolean;
  dpoy: boolean;
}

export interface RecapEntryView {
  seat: number;
  name: string;
  team: string;
  wins: number;
  losses: number;
  finish: string;
  champion: boolean;
}

export interface HeadToHeadView {
  a: string;
  b: string;
  wins: number;
  losses: number;
}

export interface RecapView {
  champion: string;
  championName: string;
  entries: RecapEntryView[];
  h2h: HeadToHeadView[];
}

export interface LeagueView {
  stage: number;
  stageName: string;
  phase: 'season' | 'awards' | 'playin' | 'playoffs' | 'recap';
  stageTotal: number;
  cursor: number;
  checkpoint: boolean;
  games: LeagueGameView[];
  standings: StandingView[] | null;
  awards: { mvp: AwardView; dpoy: AwardView } | null;
  playin: PlayInView[] | null;
  playoffs: SeriesView[] | null;
  my: MyLeagueView | null;
  recap: RecapView | null;
}

function revealedRegular(league: LeagueResult, stage: number, cursor: number): number {
  if (stage >= 4) return league.games.length;
  const totals = stageTotals(league.games);
  let revealed = 0;
  for (let index = 0; index < stage; index++) revealed += totals[index] ?? 0;
  return revealed + Math.min(cursor, totals[stage] ?? 0);
}

function partialStandings(league: LeagueResult, revealed: number, meTeam: string | null): StandingView[] {
  const records = new Map<string, { wins: number; losses: number; conference: 'east' | 'west' }>();
  for (const row of league.standings.east) records.set(row.team, { wins: 0, losses: 0, conference: 'east' });
  for (const row of league.standings.west) records.set(row.team, { wins: 0, losses: 0, conference: 'west' });
  for (const game of league.games) {
    if (game.gameNo > revealed) break;
    const home = records.get(game.home);
    const away = records.get(game.away);
    if (!home || !away) continue;
    if (game.winner === game.home) {
      home.wins += 1;
      away.losses += 1;
    } else {
      away.wins += 1;
      home.losses += 1;
    }
    records.set(game.home, home);
    records.set(game.away, away);
  }
  const humans = new Map(league.humans.map((entry) => [entry.team, entry.name]));
  return [...records.entries()]
    .map(([team, record]) => ({
      team,
      conference: record.conference,
      wins: record.wins,
      losses: record.losses,
      seed: null,
      isMine: team === meTeam,
      humanName: humans.get(team) ?? null,
    }))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.team.localeCompare(b.team));
}

function fullStandings(league: LeagueResult, meTeam: string | null): StandingView[] {
  const humans = new Map(league.humans.map((entry) => [entry.team, entry.name]));
  return [...league.standings.east, ...league.standings.west].map((row) => ({
    team: row.team,
    conference: row.conference,
    wins: row.wins,
    losses: row.losses,
    seed: row.seed,
    isMine: row.team === meTeam,
    humanName: humans.get(row.team) ?? null,
  }));
}

function seriesView(series: SeriesResult, revealedGames: number): SeriesView {
  const games = series.games.slice(0, revealedGames).map((game) => ({
    index: game.index,
    home: game.home,
    away: game.away,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    winner: game.winner,
  }));
  const complete = games.length === series.games.length;
  return {
    id: series.id,
    round: series.round,
    name: series.name,
    conference: series.conference,
    high: series.high,
    low: series.low,
    highSeed: series.highSeed,
    lowSeed: series.lowSeed,
    games,
    winner: complete ? series.winner : null,
    wins: complete ? series.wins : games.filter((game) => game.winner === series.high).length,
    losses: complete ? series.losses : games.filter((game) => game.winner === series.low).length,
    complete,
  };
}

function playoffViews(league: LeagueResult, stage: number, cursor: number): SeriesView[] {
  const currentRound = stage - 5;
  const out: SeriesView[] = [];
  for (let round = 1; round <= 4; round++) {
    const roundSeries = league.series.filter((entry) => entry.round === round);
    if (round < currentRound) {
      for (const series of roundSeries) out.push(seriesView(series, series.games.length));
      continue;
    }
    if (round > currentRound) continue;
    let remaining = cursor;
    for (const series of roundSeries) {
      const revealed = Math.min(series.games.length, Math.max(0, remaining));
      remaining -= revealed;
      out.push(seriesView(series, revealed));
    }
  }
  return out;
}

function myView(
  league: LeagueResult,
  stage: number,
  meParticipantId: string | null,
  standings: StandingView[],
): MyLeagueView | null {
  if (!meParticipantId) return null;
  const human = league.humans.find((entry) => entry.participantId === meParticipantId);
  if (!human) return null;
  const awardsRevealed = stage >= 4;
  const playInRevealed = stage >= 5;
  const recapRevealed = stage >= 10;
  const partial = standings.find((row) => row.team === human.team) ?? null;
  return {
    team: human.team,
    wins: awardsRevealed ? human.wins : partial?.wins ?? 0,
    losses: awardsRevealed ? human.losses : partial?.losses ?? 0,
    seed: awardsRevealed ? human.seed : null,
    madePlayoffs: playInRevealed ? human.madePlayoffs : null,
    finish: recapRevealed ? human.finish : null,
    champion: recapRevealed ? human.champion : null,
    ppg: awardsRevealed ? human.ppg : null,
    rpg: awardsRevealed ? human.rpg : null,
    apg: awardsRevealed ? human.apg : null,
    spg: awardsRevealed ? human.spg : null,
    bpg: awardsRevealed ? human.bpg : null,
    mvp: awardsRevealed ? human.mvp : false,
    dpoy: awardsRevealed ? human.dpoy : false,
  };
}

export function revealLeague(league: LeagueResult, stage: number, cursor: number, meParticipantId: string | null): LeagueView {
  const meTeam = league.humans.find((entry) => entry.participantId === meParticipantId)?.team ?? null;
  const humanTeams = new Set(league.humans.map((entry) => entry.team));
  const revealed = revealedRegular(league, stage, cursor);
  const total = stageTotal(league, stage);
  const checkpoint = isCheckpoint(cursor, stageGamesTotal(league, stage));

  const visible = league.games.filter((game) => game.gameNo <= revealed);
  const mine = visible.filter((game) => game.home === meTeam || game.away === meTeam);
  const friends = visible.filter((game) => humanTeams.has(game.home) && humanTeams.has(game.away));
  const recent = visible.slice(-30);
  const seen = new Set<number>();
  const games: LeagueGameView[] = [];
  for (const game of [...recent, ...mine, ...friends.slice(-20)]) {
    if (seen.has(game.gameNo)) continue;
    seen.add(game.gameNo);
    games.push({
      gameNo: game.gameNo,
      stage: game.stage,
      home: game.home,
      away: game.away,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      winner: game.winner,
      mine: game.home === meTeam || game.away === meTeam,
      friends: humanTeams.has(game.home) && humanTeams.has(game.away),
    });
  }
  games.sort((a, b) => a.gameNo - b.gameNo);

  const standings = stage >= 4 ? fullStandings(league, meTeam) : partialStandings(league, revealed, meTeam);
  const awards =
    stage >= 4
      ? {
          mvp: {
            name: league.awards.mvp.name,
            team: league.awards.mvp.team,
            mine: league.awards.mvp.participantId !== null && league.awards.mvp.participantId === meParticipantId,
            ppg: league.awards.mvp.ppg,
            rpg: league.awards.mvp.rpg,
            apg: league.awards.mvp.apg,
            spg: league.awards.mvp.spg,
            bpg: league.awards.mvp.bpg,
          },
          dpoy: {
            name: league.awards.dpoy.name,
            team: league.awards.dpoy.team,
            mine: league.awards.dpoy.participantId !== null && league.awards.dpoy.participantId === meParticipantId,
            ppg: league.awards.dpoy.ppg,
            rpg: league.awards.dpoy.rpg,
            apg: league.awards.dpoy.apg,
            spg: league.awards.dpoy.spg,
            bpg: league.awards.dpoy.bpg,
          },
        }
      : null;
  const playin =
    stage >= 5
      ? league.playin.map((game) => ({
          id: game.id,
          conference: game.conference,
          label: game.label,
          home: game.home,
          away: game.away,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          winner: game.winner,
        }))
      : null;
  const playoffs = stage >= 6 ? playoffViews(league, stage, cursor) : null;
  const recap =
    stage >= 10
      ? {
          champion: league.champion,
          championName: league.humans.find((entry) => entry.team === league.champion)?.name ?? league.champion,
          entries: league.humans
            .map((entry) => ({
              seat: entry.seat,
              name: entry.name,
              team: entry.team,
              wins: entry.wins,
              losses: entry.losses,
              finish: entry.finish,
              champion: entry.champion,
            }))
            .sort((a, b) => Number(b.champion) - Number(a.champion) || a.seat - b.seat),
          h2h: Object.entries(league.h2h).flatMap(([a, opponents]) =>
            Object.entries(opponents)
              .filter(([b]) => a < b)
              .map(([b, record]) => ({
                a: league.humans.find((entry) => entry.participantId === a)?.name ?? 'A',
                b: league.humans.find((entry) => entry.participantId === b)?.name ?? 'B',
                wins: record.wins,
                losses: record.losses,
              })),
          ),
        }
      : null;

  return {
    stage,
    stageName: STAGE_NAMES[stage] ?? 'Season',
    phase: stagePhase(stage),
    stageTotal: total,
    cursor,
    checkpoint,
    games,
    standings,
    awards,
    playin,
    playoffs,
    my: myView(league, stage, meParticipantId, standings),
    recap,
  };
}
