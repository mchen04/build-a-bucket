import type {
  HeadToHead,
  HumanSeason,
  LeagueAward,
  LeagueResult,
  PlayInGame,
  SeriesResult,
  TeamRecord,
} from '../engine/league.js';
import { stageTotals } from '../engine/league.js';

export const STAGE_COUNT = 11;
export const STAGE_NAMES = [
  'Regular season',
  'Regular season',
  'Regular season',
  'Regular season',
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
export const PLAYOFF_GAME_MS = 450;
export const HUMAN_REGULAR_MS = 60;
export const CPU_SPEEDUP = 2.4;

export function nextStage(stage: number): number {
  if (stage <= 3) return 4;
  return Math.min(10, stage + 1);
}

export function nextStageFrom(counts: readonly number[], stage: number): number {
  void counts;
  return nextStage(stage);
}

export function seasonEndsAt(counts: readonly number[], stage: number): boolean {
  return stage <= 3 && nextStageFrom(counts, stage) === 4;
}

function revealUnits(league: LeagueResult): number[][] {
  const humanTeams = new Set(league.humans.map((entry) => entry.team));
  const involvesHuman = (home: string, away: string) => humanTeams.has(home) || humanTeams.has(away);
  const units: number[][] = Array.from({ length: 11 }, () => []);
  let round = -1;
  let stage = -1;
  for (const game of league.games) {
    const list = units[game.stage] as number[];
    const slow = involvesHuman(game.home, game.away);
    if (game.round === round && game.stage === stage && list.length > 0) {
      const last = list[list.length - 1] as number;
      const size = Math.abs(last) + 1;
      list[list.length - 1] = last > 0 || slow ? size : -size;
      continue;
    }
    round = game.round;
    stage = game.stage;
    list.push(slow ? 1 : -1);
  }
  for (let roundNo = 1; roundNo <= 4; roundNo++) {
    const list = units[roundNo + 5] as number[];
    for (const series of league.series.filter((entry) => entry.round === roundNo)) {
      const slow = involvesHuman(series.high, series.low);
      for (let index = 0; index < series.games.length; index++) list.push(slow ? 1 : -1);
    }
  }
  return units;
}

function unitMs(stage: number, unit: number): number {
  const base = stage <= 3 ? HUMAN_REGULAR_MS : PLAYOFF_GAME_MS;
  return unit > 0 ? base : CPU_SPEEDUP;
}

function pacedCursor(units: readonly number[], stage: number, elapsed: number): number {
  let time = 0;
  let cursor = 0;
  for (const unit of units) {
    time += unitMs(stage, unit);
    if (time > elapsed) break;
    cursor += Math.abs(unit);
  }
  return cursor;
}

function pacedDuration(units: readonly number[], stage: number): number {
  return units.reduce((sum, unit) => sum + unitMs(stage, unit), 0);
}

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
  return stageGamesTotal(league, stage);
}

export function isCheckpoint(cursor: number, total: number): boolean {
  return cursor >= total;
}

export function isStageCheckpoint(clock: LeagueClock, stage: number, cursor: number, startedAt: number | null = null): boolean {
  if (stage === 6) return cursor === 0 && startedAt === null;
  return isCheckpoint(cursor, stageGamesTotalFrom(clock, stage));
}

export interface LeagueClock {
  counts: number[];
  playin: number;
  seriesCounts: number[];
  seriesGames: number[];
  units?: number[][];
  qualified?: string[];
  humanSeasons?: { participantId: string; name: string; team: string; wins: number; losses: number; seed: number }[];
  series?: { round: number; name: string; conference: 'east' | 'west' | 'finals'; high: string; low: string; winner: string; wins: number; losses: number }[];
  playinGames?: { conference: 'east' | 'west'; label: string; home: string; away: string; winner: string }[];
  champion?: string | null;
  awards?: { mvp: { name: string; team: string }; dpoy: { name: string; team: string } } | null;
}

export function clockFromLeague(league: LeagueResult): LeagueClock {
  const counts = stageTotals(league.games);
  const seriesCounts = [1, 2, 3, 4].map((round) => league.series.filter((entry) => entry.round === round).length);
  const seriesGames = [1, 2, 3, 4].map((round) =>
    league.series.filter((entry) => entry.round === round).reduce((sum, entry) => sum + entry.games.length, 0),
  );
  const qualified = [...new Set(league.series.filter((entry) => entry.round === 1).flatMap((entry) => [entry.high, entry.low]))];
  return {
    counts,
    playin: league.playin.length,
    seriesCounts,
    seriesGames,
    units: revealUnits(league),
    qualified,
    humanSeasons: league.humans.map((entry) => ({
      participantId: entry.participantId,
      name: entry.name,
      team: entry.team,
      wins: entry.wins,
      losses: entry.losses,
      seed: entry.seed,
    })),
    series: league.series.map((entry) => ({
      round: entry.round,
      name: entry.name,
      conference: entry.conference,
      high: entry.high,
      low: entry.low,
      winner: entry.winner,
      wins: entry.wins,
      losses: entry.losses,
    })),
    playinGames: league.playin.map((entry) => ({
      conference: entry.conference,
      label: entry.label,
      home: entry.home,
      away: entry.away,
      winner: entry.winner,
    })),
    champion: league.champion,
    awards: {
      mvp: { name: league.awards.mvp.name, team: league.awards.mvp.team },
      dpoy: { name: league.awards.dpoy.name, team: league.awards.dpoy.team },
    },
  };
}

export function stageGamesTotalFrom(clock: LeagueClock, stage: number): number {
  if (stage <= 3) return clock.counts[stage] ?? 0;
  if (stage === 5) return clock.playin;
  if (stage >= 6 && stage <= 9) return clock.seriesGames[stage - 6] ?? 0;
  return 0;
}

export function stageTotalFrom(clock: LeagueClock, stage: number): number {
  return stageGamesTotalFrom(clock, stage);
}

export function stageCursorAtFrom(clock: LeagueClock, stage: number, startedAt: number | null, now: number): number {
  if (stage === 6) {
    if (startedAt === null) return 0;
    const total = stageGamesTotalFrom(clock, 6);
    const units = clock.units?.[6];
    if (!units || units.length === 0) return total;
    return Math.min(total, pacedCursor(units, 6, Math.max(0, now - startedAt)));
  }
  const total = stageGamesTotalFrom(clock, stage);
  if (total === 0) return 0;
  if (startedAt === null) return 0;
  const elapsed = Math.max(0, now - startedAt);
  const units = clock.units?.[stage];
  if (units && units.length > 0 && (stage <= 3 || (stage >= 6 && stage <= 9))) {
    return Math.min(total, pacedCursor(units, stage, elapsed));
  }
  if (stage <= 3) {
    return Math.min(total, Math.floor(elapsed / REGULAR_BATCH_MS) * REGULAR_BATCH_SIZE);
  }
  if (stage >= 6 && stage <= 9) {
    return Math.min(total, Math.floor(elapsed / PLAYOFF_GAME_MS));
  }
  return total;
}

export function checkpointAtFrom(clock: LeagueClock, stage: number, startedAt: number | null): number | null {
  if (startedAt === null) return null;
  if (stage === 6) return startedAt;
  const total = stageGamesTotalFrom(clock, stage);
  if (total === 0) return startedAt;
  const units = clock.units?.[stage];
  if (units && units.length > 0 && (stage <= 3 || (stage >= 6 && stage <= 9))) {
    return startedAt + Math.ceil(pacedDuration(units, stage));
  }
  if (stage <= 3) return startedAt + Math.ceil(total / REGULAR_BATCH_SIZE) * REGULAR_BATCH_MS;
  if (stage >= 6 && stage <= 9) return startedAt + total * PLAYOFF_GAME_MS;
  return startedAt;
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

export function limitPlayoffs(playoffs: SeriesView[] | null | undefined, limit: number): SeriesView[] | null {
  if (!playoffs) return null;
  let left = Math.max(0, limit);
  return playoffs.map((series) => {
    const games = series.games.slice(0, Math.max(0, left));
    left -= games.length;
    const wins = games.filter((game) => game.winner === series.high).length;
    const losses = games.filter((game) => game.winner === series.low).length;
    const complete = games.length === series.games.length && series.complete;
    return { ...series, games, wins, losses, complete, winner: complete ? series.winner : null };
  });
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
  qualified: boolean | null;
  series: {
    id: string;
    round: number;
    name: string;
    high: string;
    low: string;
    wins: number;
    losses: number;
    complete: boolean;
    winner: string | null;
    advanced: boolean;
  } | null;
  eliminated: boolean;
  eliminatedRound: string | null;
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

export interface RevealData {
  games: LeagueResult['games'];
  gamesTotal: number;
  stageCounts: number[];
  playinCount: number;
  seriesCounts: number[];
  seriesGames: number[];
  standings: { east: TeamRecord[]; west: TeamRecord[] } | null;
  partial: { visible: number; records: { team: string; conference: 'east' | 'west'; wins: number; losses: number }[] } | null;
  humans: HumanSeason[];
  awards: { mvp: LeagueAward; dpoy: LeagueAward } | null;
  playin: PlayInGame[] | null;
  series: SeriesResult[] | null;
  champion: string | null;
  h2h: Record<string, Record<string, HeadToHead>> | null;
}

function revealedRegularFrom(data: RevealData, stage: number, cursor: number): number {
  if (stage >= 4) return data.gamesTotal;
  let revealed = 0;
  for (let index = 0; index < stage; index++) revealed += data.stageCounts[index] ?? 0;
  return revealed + Math.min(cursor, data.stageCounts[stage] ?? 0);
}

function partialStandingsFrom(data: RevealData, revealed: number, meTeam: string | null): StandingView[] {
  const humans = new Map(data.humans.map((entry) => [entry.team, entry.name]));
  if (data.partial) {
    return data.partial.records.map((record) => ({
      team: record.team,
      conference: record.conference,
      wins: record.wins,
      losses: record.losses,
      seed: null,
      isMine: record.team === meTeam,
      humanName: humans.get(record.team) ?? null,
    }));
  }
  const records = new Map<string, { wins: number; losses: number; conference: 'east' | 'west' }>();
  for (const row of data.standings?.east ?? []) records.set(row.team, { wins: 0, losses: 0, conference: 'east' });
  for (const row of data.standings?.west ?? []) records.set(row.team, { wins: 0, losses: 0, conference: 'west' });
  for (const game of data.games) {
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

function fullStandingsFrom(data: RevealData, meTeam: string | null): StandingView[] {
  const humans = new Map(data.humans.map((entry) => [entry.team, entry.name]));
  return [...(data.standings?.east ?? []), ...(data.standings?.west ?? [])].map((row) => ({
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

export function playoffViewsFrom(data: RevealData, stage: number, cursor: number): SeriesView[] {
  const currentRound = stage - 5;
  const out: SeriesView[] = [];
  for (let round = 1; round <= 4; round++) {
    const roundSeries = (data.series ?? []).filter((entry) => entry.round === round);
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

function myViewFrom(
  data: RevealData,
  stage: number,
  meParticipantId: string | null,
  standings: StandingView[],
  playoffs: SeriesView[] | null,
): MyLeagueView | null {
  if (!meParticipantId) return null;
  const human = data.humans.find((entry) => entry.participantId === meParticipantId);
  if (!human) return null;
  const awardsRevealed = stage >= 4;
  const playInRevealed = stage >= 5;
  const recapRevealed = stage >= 10;
  const partial = standings.find((row) => row.team === human.team) ?? null;
  const mine = (playoffs ?? [])
    .filter((series) => series.high === human.team || series.low === human.team)
    .sort((a, b) => b.round - a.round)[0] ?? null;
  const eliminated = mine !== null && mine.complete && mine.winner !== human.team;
  return {
    team: human.team,
    wins: awardsRevealed ? human.wins : partial?.wins ?? 0,
    losses: awardsRevealed ? human.losses : partial?.losses ?? 0,
    seed: awardsRevealed ? human.seed : null,
    madePlayoffs: playInRevealed ? human.madePlayoffs : null,
    qualified: playInRevealed ? human.madePlayoffs : null,
    series: mine
      ? {
          id: mine.id,
          round: mine.round,
          name: mine.name,
          high: mine.high,
          low: mine.low,
          wins: mine.wins,
          losses: mine.losses,
          complete: mine.complete,
          winner: mine.winner,
          advanced: mine.complete && mine.winner === human.team,
        }
      : null,
    eliminated,
    eliminatedRound: eliminated && mine ? mine.name : null,
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

export function assembleLeagueView(
  data: RevealData,
  stage: number,
  cursor: number,
  meParticipantId: string | null,
  startedAt: number | null = null,
): LeagueView {
  const meTeam = data.humans.find((entry) => entry.participantId === meParticipantId)?.team ?? null;
  const humanTeams = new Set(data.humans.map((entry) => entry.team));
  const revealed = revealedRegularFrom(data, stage, cursor);
  const total = stageTotalFrom(
    {
      counts: data.stageCounts,
      playin: data.playinCount,
      seriesCounts: data.seriesCounts,
      seriesGames: data.seriesGames,
    },
    stage,
  );
  const checkpoint = isStageCheckpoint(
    {
      counts: data.stageCounts,
      playin: data.playinCount,
      seriesCounts: data.seriesCounts,
      seriesGames: data.seriesGames,
    },
    stage,
    cursor,
    startedAt,
  );

  const visible = data.games.filter((game) => game.gameNo <= revealed);
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

  const standings = stage >= 4 ? fullStandingsFrom(data, meTeam) : partialStandingsFrom(data, revealed, meTeam);
  const awards =
    stage >= 4 && data.awards
      ? {
          mvp: {
            name: data.awards.mvp.name,
            team: data.awards.mvp.team,
            mine: data.awards.mvp.participantId !== null && data.awards.mvp.participantId === meParticipantId,
            ppg: data.awards.mvp.ppg,
            rpg: data.awards.mvp.rpg,
            apg: data.awards.mvp.apg,
            spg: data.awards.mvp.spg,
            bpg: data.awards.mvp.bpg,
          },
          dpoy: {
            name: data.awards.dpoy.name,
            team: data.awards.dpoy.team,
            mine: data.awards.dpoy.participantId !== null && data.awards.dpoy.participantId === meParticipantId,
            ppg: data.awards.dpoy.ppg,
            rpg: data.awards.dpoy.rpg,
            apg: data.awards.dpoy.apg,
            spg: data.awards.dpoy.spg,
            bpg: data.awards.dpoy.bpg,
          },
        }
      : null;
  const playin =
    stage >= 5 && data.playin
      ? data.playin.map((game) => ({
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
  const playoffs = stage >= 6 ? playoffViewsFrom(data, stage, cursor) : null;
  const recap =
    stage >= 10 && data.champion !== null && data.h2h
      ? {
          champion: data.champion,
          championName: data.humans.find((entry) => entry.team === data.champion)?.name ?? data.champion,
          entries: data.humans
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
          h2h: Object.entries(data.h2h).flatMap(([a, opponents]) =>
            Object.entries(opponents)
              .filter(([b]) => a < b)
              .map(([b, record]) => ({
                a: data.humans.find((entry) => entry.participantId === a)?.name ?? 'A',
                b: data.humans.find((entry) => entry.participantId === b)?.name ?? 'B',
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
    my: myViewFrom(data, stage, meParticipantId, standings, playoffs),
    recap,
  };
}

export function revealLeague(
  league: LeagueResult,
  stage: number,
  cursor: number,
  meParticipantId: string | null,
  startedAt: number | null = null,
): LeagueView {
  return assembleLeagueView(
    {
      games: league.games,
      gamesTotal: league.games.length,
      stageCounts: stageTotals(league.games),
      playinCount: league.playin.length,
      seriesCounts: [1, 2, 3, 4].map((round) => league.series.filter((entry) => entry.round === round).length),
      seriesGames: [1, 2, 3, 4].map((round) =>
        league.series.filter((entry) => entry.round === round).reduce((sum, entry) => sum + entry.games.length, 0),
      ),
      standings: league.standings,
      partial: null,
      humans: league.humans,
      awards: league.awards,
      playin: league.playin,
      series: league.series,
      champion: league.champion,
      h2h: league.h2h,
    },
    stage,
    cursor,
    meParticipantId,
    startedAt,
  );
}
