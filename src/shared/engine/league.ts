import { ovrFromValues } from './ovr.js';
import { clamp, seededRng, seededShuffle, type Rng } from './rng.js';
import { rollStats, teamStrength, winProbFor } from './season.js';
import {
  ALLTIME_TEAMS,
  CURRENT_TEAMS,
  DISPLAY_DPOY_ALLTIME,
  DISPLAY_DPOY_CURRENT,
  DISPLAY_MVP_ALLTIME,
  DISPLAY_MVP_CURRENT,
  EAST,
  EAST_SET,
  MVP_BENCHMARKS_ALLTIME,
  MVP_BENCHMARKS_CURRENT,
  WEST,
} from './rules.js';
import type { Era, Position } from './types.js';

export type LeagueMode = 'normal' | 'salary' | 'squad';
export type Conference = 'east' | 'west';

export const LEAGUE_TEAMS: string[] = [...EAST, ...WEST];
export const REGULAR_GAMES = 82;
export const QUARTER_ROUNDS = [21, 41, 62, 82];
export const PLAYOFF_ROUND_NAMES = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'];

export interface ScheduledGame {
  gameNo: number;
  round: number;
  stage: number;
  home: string;
  away: string;
}

export interface LeagueGameResult extends ScheduledGame {
  homeScore: number;
  awayScore: number;
  winner: string;
}

export interface HumanTeamInput {
  participantId: string;
  seat: number;
  name: string;
  team: string;
  position: Position;
  ovr: number;
  values: Record<string, number>;
  squadStrength?: { off: number; def: number };
  squadPlayers?: { slot: string; position: Position; values: Record<string, number> }[];
}

export interface TeamRecord {
  team: string;
  conference: Conference;
  wins: number;
  losses: number;
  confWins: number;
  confLosses: number;
  pointsFor: number;
  pointsAgainst: number;
  seed: number | null;
}

export interface PlayInGame {
  id: string;
  conference: Conference;
  label: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  winner: string;
}

export interface SeriesGame {
  index: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  winner: string;
}

export interface SeriesResult {
  id: string;
  round: number;
  name: string;
  conference: Conference | 'finals';
  high: string;
  low: string;
  highSeed: number;
  lowSeed: number;
  games: SeriesGame[];
  winner: string;
  wins: number;
  losses: number;
}

export interface LeagueAward {
  name: string;
  team: string;
  participantId: string | null;
  ppg?: number;
  rpg?: number;
  apg?: number;
  spg?: number;
  bpg?: number;
}

export interface HumanSeason {
  participantId: string;
  seat: number;
  name: string;
  team: string;
  ovr: number;
  wins: number;
  losses: number;
  seed: number;
  madePlayoffs: boolean;
  playIn: boolean;
  champion: boolean;
  finish: string;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  mvp: boolean;
  dpoy: boolean;
}

export interface HeadToHead {
  wins: number;
  losses: number;
}

export interface LeagueResult {
  seed: string;
  era: Era;
  mode: LeagueMode;
  games: LeagueGameResult[];
  standings: { east: TeamRecord[]; west: TeamRecord[] };
  playin: PlayInGame[];
  series: SeriesResult[];
  champion: string;
  awards: { mvp: LeagueAward; dpoy: LeagueAward };
  humans: HumanSeason[];
  h2h: Record<string, Record<string, HeadToHead>>;
}

function conferenceOf(team: string): Conference {
  return EAST_SET.has(team) ? 'east' : 'west';
}

function tableFor(era: Era): Record<string, { off: number; def: number }> {
  return era === 'alltime' ? ALLTIME_TEAMS : CURRENT_TEAMS;
}

function circleRounds(teams: string[]): [string, string][][] {
  const n = teams.length;
  const arr = [...teams];
  const rounds: [string, string][][] = [];
  for (let round = 0; round < n - 1; round++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i] as string;
      const b = arr[n - 1 - i] as string;
      pairs.push(round % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    const fixed = arr[0] as string;
    const rest = arr.slice(1);
    rest.unshift(rest.pop() as string);
    arr.splice(0, arr.length, fixed, ...rest);
  }
  return rounds;
}

function extraGames(seed: string): [string, string][] {
  const out: [string, string][] = [];
  for (const conference of [EAST, WEST]) {
    const distances = seededShuffle([1, 2, 3, 4, 5, 6, 7], `${seed}:distances:${conference[0]}`).slice(0, 6);
    for (const distance of distances) {
      for (let i = 0; i < conference.length; i++) {
        const a = conference[i] as string;
        const b = conference[(i + distance) % conference.length] as string;
        out.push([a, b], [b, a]);
      }
    }
  }
  return out;
}

export function buildSchedule(seed: string): ScheduledGame[] {
  const base = circleRounds(LEAGUE_TEAMS);
  const rounds: [string, string][][] = [...base, ...base.map((round) => round.map(([home, away]) => [away, home] as [string, string]))];
  const used = rounds.map((round) => new Set(round.flat()));
  for (const [home, away] of extraGames(seed)) {
    let placed = false;
    for (let index = 0; index < rounds.length; index++) {
      const round = rounds[index] as [string, string][];
      const seen = used[index] as Set<string>;
      if (round.length >= LEAGUE_TEAMS.length / 2) continue;
      if (seen.has(home) || seen.has(away)) continue;
      round.push([home, away]);
      seen.add(home);
      seen.add(away);
      placed = true;
      break;
    }
    if (!placed) {
      rounds.push([[home, away]]);
      used.push(new Set([home, away]));
    }
  }
  const games: ScheduledGame[] = [];
  let gameNo = 0;
  rounds.forEach((round, index) => {
    const roundNo = index + 1;
    const stage = roundNo <= QUARTER_ROUNDS[0]! ? 0 : roundNo <= QUARTER_ROUNDS[1]! ? 1 : roundNo <= QUARTER_ROUNDS[2]! ? 2 : 3;
    for (const [home, away] of round) {
      gameNo += 1;
      games.push({ gameNo, round: roundNo, stage, home, away });
    }
  });
  return games;
}

export function stageTotals(games: readonly ScheduledGame[]): number[] {
  const totals = [0, 0, 0, 0];
  for (const game of games) totals[game.stage] = (totals[game.stage] ?? 0) + 1;
  return totals;
}

function matchupProbability(a: number, b: number): number {
  const denom = a + b - 2 * a * b;
  const raw = denom === 0 ? 0.5 : (a - a * b) / denom;
  return clamp(0.5 + (raw - 0.5) * 1.12, 0.15, 0.85);
}

function humanProbability(human: HumanTeamInput, era: Era): number {
  if (human.squadStrength) {
    const score = (human.squadStrength.off + human.squadStrength.def) / 200;
    return clamp(0.2 + ((score - 0.59) / 0.24) * 0.57, 0.13, 0.87);
  }
  return winProbFor(human.ovr, human.team, era);
}

function probabilityFor(team: string, humans: Map<string, HumanTeamInput>, era: Era): number {
  const human = humans.get(team);
  if (human) return humanProbability(human, era);
  return teamStrength(team, tableFor(era));
}

function scoreGame(rng: Rng, homeWon: boolean): { homeScore: number; awayScore: number } {
  const base = 94 + Math.floor(rng() * 22);
  const margin = 3 + Math.floor(rng() * 17);
  return homeWon ? { homeScore: base + margin, awayScore: base } : { homeScore: base, awayScore: base + margin };
}

function playGame(
  home: string,
  away: string,
  humans: Map<string, HumanTeamInput>,
  era: Era,
  rng: Rng,
): { homeScore: number; awayScore: number; winner: string } {
  const pHome = clamp(matchupProbability(probabilityFor(home, humans, era), probabilityFor(away, humans, era)) + 0.02, 0.1, 0.9);
  const homeWon = rng() < pHome;
  const score = scoreGame(rng, homeWon);
  return { ...score, winner: homeWon ? home : away };
}

function emptyRecord(team: string): TeamRecord {
  return {
    team,
    conference: conferenceOf(team),
    wins: 0,
    losses: 0,
    confWins: 0,
    confLosses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    seed: null,
  };
}

function headToHeadWins(a: string, b: string, games: readonly LeagueGameResult[]): number {
  let wins = 0;
  for (const game of games) {
    if (game.home === a && game.away === b && game.winner === a) wins += 1;
    else if (game.home === b && game.away === a && game.winner === a) wins += 1;
  }
  return wins;
}

function sortConference(teams: string[], records: Map<string, TeamRecord>, games: readonly LeagueGameResult[], seed: string): TeamRecord[] {
  const coin = new Map(teams.map((team) => [team, seededRng(`${seed}:coin:${team}`)()]));
  const record = (team: string) => records.get(team) ?? emptyRecord(team);
  return [...teams].sort((a, b) => {
    const ra = record(a);
    const rb = record(b);
    if (ra.wins !== rb.wins) return rb.wins - ra.wins;
    const h2h = headToHeadWins(a, b, games) - headToHeadWins(b, a, games);
    if (h2h !== 0) return -h2h;
    const pa = ra.confWins / Math.max(1, ra.confWins + ra.confLosses);
    const pb = rb.confWins / Math.max(1, rb.confWins + rb.confLosses);
    if (pa !== pb) return pb - pa;
    const ca = coin.get(a) ?? 0;
    const cb = coin.get(b) ?? 0;
    if (ca !== cb) return cb - ca;
    return a.localeCompare(b);
  }).map(record);
}

function playInFor(
  conference: Conference,
  seeds: string[],
  humans: Map<string, HumanTeamInput>,
  era: Era,
  seed: string,
): { seeds: string[]; games: PlayInGame[]; advanced: Set<string> } {
  const games: PlayInGame[] = [];
  const at = (index: number) => seeds[index] as string;
  const first = playGame(at(6), at(7), humans, era, seededRng(`${seed}:playin:${conference}:a`));
  games.push({ id: `${conference}-a`, conference, label: '7 vs 8', home: at(6), away: at(7), ...first });
  const second = playGame(at(8), at(9), humans, era, seededRng(`${seed}:playin:${conference}:b`));
  games.push({ id: `${conference}-b`, conference, label: '9 vs 10', home: at(8), away: at(9), ...second });
  const loserFirst = first.winner === at(6) ? at(7) : at(6);
  const third = playGame(loserFirst, second.winner, humans, era, seededRng(`${seed}:playin:${conference}:c`));
  games.push({ id: `${conference}-c`, conference, label: 'Last spot', home: loserFirst, away: second.winner, ...third });
  const advanced = new Set([first.winner, third.winner]);
  return { seeds: [...seeds.slice(0, 6), first.winner, third.winner], games, advanced };
}

function playSeries(
  id: string,
  round: number,
  conference: Conference | 'finals',
  high: string,
  low: string,
  highSeed: number,
  lowSeed: number,
  humans: Map<string, HumanTeamInput>,
  era: Era,
  seed: string,
): SeriesResult {
  const pattern: ('high' | 'low')[] = ['high', 'high', 'low', 'low', 'high', 'low', 'high'];
  const games: SeriesGame[] = [];
  let highWins = 0;
  let lowWins = 0;
  for (let index = 0; index < pattern.length && highWins < 4 && lowWins < 4; index++) {
    const home = pattern[index] === 'high' ? high : low;
    const away = home === high ? low : high;
    const result = playGame(home, away, humans, era, seededRng(`${seed}:series:${id}:${index}`));
    games.push({ index, home, away, homeScore: result.homeScore, awayScore: result.awayScore, winner: result.winner });
    if (result.winner === high) highWins += 1;
    else lowWins += 1;
  }
  return {
    id,
    round,
    name: PLAYOFF_ROUND_NAMES[round - 1] ?? 'Round',
    conference,
    high,
    low,
    highSeed,
    lowSeed,
    games,
    winner: highWins === 4 ? high : low,
    wins: highWins,
    losses: lowWins,
  };
}

function bracketRound(
  round: number,
  conference: Conference,
  seeds: string[],
  humans: Map<string, HumanTeamInput>,
  era: Era,
  seed: string,
): SeriesResult[] {
  const seedOf = (team: string) => seeds.indexOf(team) + 1;
  const pair = (a: number, b: number, id: string) => {
    const teamA = seeds[a - 1] as string;
    const teamB = seeds[b - 1] as string;
    const high = seedOf(teamA) <= seedOf(teamB) ? teamA : teamB;
    const low = high === teamA ? teamB : teamA;
    return playSeries(id, round, conference, high, low, seedOf(high), seedOf(low), humans, era, seed);
  };
  if (round === 1) {
    return [pair(1, 8, `${conference}-r1-1`), pair(4, 5, `${conference}-r1-2`), pair(3, 6, `${conference}-r1-3`), pair(2, 7, `${conference}-r1-4`)];
  }
  return [];
}

function nextRound(
  round: number,
  conference: Conference,
  previous: SeriesResult[],
  humans: Map<string, HumanTeamInput>,
  era: Era,
  seed: string,
): SeriesResult[] {
  const out: SeriesResult[] = [];
  for (let index = 0; index < previous.length; index += 2) {
    const a = previous[index] as SeriesResult;
    const b = previous[index + 1] as SeriesResult;
    const high = a.highSeed <= b.highSeed ? a.winner : b.winner;
    const low = high === a.winner ? b.winner : a.winner;
    const highSeed = high === a.winner ? a.highSeed : b.highSeed;
    const lowSeed = low === a.winner ? a.highSeed : b.highSeed;
    out.push(playSeries(`${conference}-r${round}-${index / 2 + 1}`, round, conference, high, low, highSeed, lowSeed, humans, era, seed));
  }
  return out;
}

function awardScore(ppg: number, apg: number, rpg: number): number {
  return ppg + apg * 1.5 + rpg * 0.75;
}

function pickCpuAward(
  era: Era,
  seed: string,
  kind: 'mvp' | 'dpoy',
): LeagueAward {
  const rng = seededRng(`${seed}:award:${kind}`);
  if (kind === 'mvp') {
    const pool = era === 'alltime' ? DISPLAY_MVP_ALLTIME : DISPLAY_MVP_CURRENT;
    const pick = pool[Math.floor(rng() * pool.length)] ?? pool[0]!;
    return {
      name: pick.name,
      team: pick.team,
      participantId: null,
      ppg: (pick.ppg[0] ?? 0) + rng() * ((pick.ppg[1] ?? 0) - (pick.ppg[0] ?? 0)),
      rpg: (pick.rpg[0] ?? 0) + rng() * ((pick.rpg[1] ?? 0) - (pick.rpg[0] ?? 0)),
      apg: (pick.apg[0] ?? 0) + rng() * ((pick.apg[1] ?? 0) - (pick.apg[0] ?? 0)),
    };
  }
  if (era === 'alltime') {
    const pool = DISPLAY_DPOY_ALLTIME;
    const pick = pool[Math.floor(rng() * pool.length)] ?? pool[0]!;
    return {
      name: pick.name,
      team: pick.team,
      participantId: null,
      spg: (pick.spg[0] ?? 0) + rng() * ((pick.spg[1] ?? 0) - (pick.spg[0] ?? 0)),
      bpg: (pick.bpg[0] ?? 0) + rng() * ((pick.bpg[1] ?? 0) - (pick.bpg[0] ?? 0)),
    };
  }
  const pick = DISPLAY_DPOY_CURRENT;
  return {
    name: pick.name,
    team: pick.team,
    participantId: null,
    spg: (pick.spg[0] ?? 0) + rng() * ((pick.spg[1] ?? 0) - (pick.spg[0] ?? 0)),
    bpg: (pick.bpg[0] ?? 0) + rng() * ((pick.bpg[1] ?? 0) - (pick.bpg[0] ?? 0)),
  };
}

function finishFor(team: string, series: readonly SeriesResult[], playIn: readonly PlayInGame[], champion: string): string {
  if (team === champion) return 'Champion';
  const lost = series.find((entry) => entry.winner !== team && (entry.high === team || entry.low === team));
  if (lost) {
    if (lost.round === 4) return 'Finals loss';
    if (lost.round === 3) return 'Conference finals';
    if (lost.round === 2) return 'Semis';
    return 'First round';
  }
  if (playIn.some((entry) => entry.home === team || entry.away === team)) return 'Play-in exit';
  return 'Missed playoffs';
}

export function simulateLeague(input: {
  seed: string;
  era: Era;
  mode: LeagueMode;
  humans: HumanTeamInput[];
}): LeagueResult {
  const { seed, era, mode } = input;
  const humans = new Map(input.humans.map((entry) => [entry.team, entry]));
  const schedule = buildSchedule(seed);
  const games: LeagueGameResult[] = schedule.map((game) => {
    const result = playGame(game.home, game.away, humans, era, seededRng(`${seed}:game:${game.gameNo}`));
    return { ...game, ...result };
  });

  const records = new Map<string, TeamRecord>(LEAGUE_TEAMS.map((team) => [team, emptyRecord(team)]));
  for (const game of games) {
    const home = records.get(game.home) as TeamRecord;
    const away = records.get(game.away) as TeamRecord;
    home.pointsFor += game.homeScore;
    home.pointsAgainst += game.awayScore;
    away.pointsFor += game.awayScore;
    away.pointsAgainst += game.homeScore;
    if (game.winner === game.home) {
      home.wins += 1;
      away.losses += 1;
      if (home.conference === away.conference) {
        home.confWins += 1;
        away.confLosses += 1;
      }
    } else {
      away.wins += 1;
      home.losses += 1;
      if (home.conference === away.conference) {
        away.confWins += 1;
        home.confLosses += 1;
      }
    }
  }

  const east = sortConference(EAST, records, games, seed);
  const west = sortConference(WEST, records, games, seed);
  east.forEach((row, index) => {
    row.seed = index + 1;
  });
  west.forEach((row, index) => {
    row.seed = index + 1;
  });

  const eastPlayIn = playInFor('east', east.map((row) => row.team), humans, era, seed);
  const westPlayIn = playInFor('west', west.map((row) => row.team), humans, era, seed);
  const playin = [...eastPlayIn.games, ...westPlayIn.games];

  const eastR1 = bracketRound(1, 'east', eastPlayIn.seeds, humans, era, seed);
  const westR1 = bracketRound(1, 'west', westPlayIn.seeds, humans, era, seed);
  const eastR2 = nextRound(2, 'east', eastR1, humans, era, seed);
  const westR2 = nextRound(2, 'west', westR1, humans, era, seed);
  const eastR3 = nextRound(3, 'east', eastR2, humans, era, seed);
  const westR3 = nextRound(3, 'west', westR2, humans, era, seed);
  const eastChamp = (eastR3[0] as SeriesResult).winner;
  const westChamp = (westR3[0] as SeriesResult).winner;
  const eastSeed = eastPlayIn.seeds.indexOf(eastChamp) + 1;
  const westSeed = westPlayIn.seeds.indexOf(westChamp) + 1;
  const finalsHigh = eastSeed <= westSeed ? eastChamp : westChamp;
  const finalsLow = finalsHigh === eastChamp ? westChamp : eastChamp;
  const finals = playSeries(
    'finals',
    4,
    'finals',
    finalsHigh,
    finalsLow,
    finalsHigh === eastChamp ? eastSeed : westSeed,
    finalsLow === eastChamp ? eastSeed : westSeed,
    humans,
    era,
    seed,
  );
  const series = [...eastR1, ...westR1, ...eastR2, ...westR2, ...eastR3, ...westR3, finals];
  const champion = finals.winner;

  const humanSeasons: HumanSeason[] = input.humans.map((human) => {
    const record = records.get(human.team) as TeamRecord;
    const stats = rollStats(human.values, human.position, seededRng(`${seed}:stats:${human.participantId}`));
    const playIn = playin.some((entry) => entry.home === human.team || entry.away === human.team);
    const advanced = eastPlayIn.advanced.has(human.team) || westPlayIn.advanced.has(human.team);
    return {
      participantId: human.participantId,
      seat: human.seat,
      name: human.name,
      team: human.team,
      ovr: human.ovr,
      wins: record.wins,
      losses: record.losses,
      seed: record.seed ?? 15,
      madePlayoffs: (record.seed ?? 15) <= 6 || advanced,
      playIn,
      champion: human.team === champion,
      finish: finishFor(human.team, series, playin, champion),
      ppg: stats.ppg,
      rpg: stats.rpg,
      apg: stats.apg,
      spg: stats.spg,
      bpg: stats.bpg,
      mvp: false,
      dpoy: false,
    };
  });

  const mvpRng = seededRng(`${seed}:award:mvp`);
  const benchmarks = (era === 'alltime' ? MVP_BENCHMARKS_ALLTIME : MVP_BENCHMARKS_CURRENT).map(([pMin, pSpan, aMin, aSpan, rMin, rSpan]) =>
    awardScore(
      (pMin as number) + mvpRng() * (pSpan as number),
      (aMin as number) + mvpRng() * (aSpan as number),
      (rMin as number) + mvpRng() * (rSpan as number),
    ),
  );
  const bestHuman = [...humanSeasons].sort((a, b) => awardScore(b.ppg, b.apg, b.rpg) - awardScore(a.ppg, a.apg, a.rpg))[0];
  const mvp =
    bestHuman && awardScore(bestHuman.ppg, bestHuman.apg, bestHuman.rpg) > Math.max(...benchmarks)
      ? { name: bestHuman.name, team: bestHuman.team, participantId: bestHuman.participantId, ppg: bestHuman.ppg, rpg: bestHuman.rpg, apg: bestHuman.apg }
      : pickCpuAward(era, seed, 'mvp');
  if (mvp.participantId) {
    const winner = humanSeasons.find((entry) => entry.participantId === mvp.participantId);
    if (winner) winner.mvp = true;
  }

  const dpoyRng = seededRng(`${seed}:award:dpoy`);
  const dpoyThreshold = 26 + dpoyRng() * 10;
  const dpoyCandidates = humanSeasons
    .filter((entry) => entry.participantId !== mvp.participantId)
    .map((entry) => ({ entry, score: entry.spg * 10 + entry.bpg * 8 + (entry.seed <= 4 ? 4 : entry.seed <= 8 ? 2 : 0) }))
    .sort((a, b) => b.score - a.score);
  const bestDpoy = dpoyCandidates[0];
  const dpoy =
    bestDpoy && bestDpoy.score >= dpoyThreshold
      ? { name: bestDpoy.entry.name, team: bestDpoy.entry.team, participantId: bestDpoy.entry.participantId, spg: bestDpoy.entry.spg, bpg: bestDpoy.entry.bpg }
      : pickCpuAward(era, seed, 'dpoy');
  if (dpoy.participantId) {
    const winner = humanSeasons.find((entry) => entry.participantId === dpoy.participantId);
    if (winner) winner.dpoy = true;
  }

  const h2h: Record<string, Record<string, HeadToHead>> = {};
  for (const a of input.humans) {
    h2h[a.participantId] = {};
    for (const b of input.humans) {
      if (a.participantId === b.participantId) continue;
      let wins = 0;
      let losses = 0;
      const count = (home: string, away: string, winner: string) => {
        if (home === a.team && away === b.team) {
          if (winner === a.team) wins += 1;
          else losses += 1;
        } else if (home === b.team && away === a.team) {
          if (winner === a.team) wins += 1;
          else losses += 1;
        }
      };
      for (const game of games) count(game.home, game.away, game.winner);
      for (const game of playin) count(game.home, game.away, game.winner);
      for (const entry of series) for (const game of entry.games) count(game.home, game.away, game.winner);
      h2h[a.participantId]![b.participantId] = { wins, losses };
    }
  }

  return {
    seed,
    era,
    mode,
    games,
    standings: { east, west },
    playin,
    series,
    champion,
    awards: { mvp, dpoy },
    humans: humanSeasons,
    h2h,
  };
}

export function humanOvr(values: Record<string, number>, position: Position): number {
  return ovrFromValues(values, position);
}
