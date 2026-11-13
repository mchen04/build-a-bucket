import { computeOvr } from './ovr';
import {
  ALLTIME_FINALS_OPPS,
  ALLTIME_TEAMS,
  CURRENT_FINALS_OPPS,
  CURRENT_TEAMS,
  DISPLAY_DPOY_ALLTIME,
  DISPLAY_DPOY_CURRENT,
  DISPLAY_MVP_ALLTIME,
  DISPLAY_MVP_CURRENT,
  EAST,
  EAST_SET,
  MVP_BENCHMARKS_ALLTIME,
  MVP_BENCHMARKS_CURRENT,
  PER_LEAGUE,
  WEST,
} from './rules';
import { clamp, round1, uniform, type Rng } from './rng';
import type {
  AwardWinner,
  Build,
  GameLine,
  PlayInRound,
  PlayoffRound,
  SeasonResult,
  SeriesRound,
  StandingRow,
} from './types';

type TeamTable = Record<string, { off: number; def: number }>;

const leagueAstFg = PER_LEAGUE.ast / PER_LEAGUE.fg;
const leagueFactor = 2 / 3 - (0.5 * leagueAstFg) / (2 * (PER_LEAGUE.fg / PER_LEAGUE.ft));
const leaguePtsPerPoss = PER_LEAGUE.pts / (PER_LEAGUE.fga - PER_LEAGUE.orb + PER_LEAGUE.tov + 0.44 * PER_LEAGUE.fta);
const leagueOrbPct = (PER_LEAGUE.trb - PER_LEAGUE.orb) / PER_LEAGUE.trb;

interface PerLine {
  mp: number;
  fg: number;
  fga: number;
  tp: number;
  ft: number;
  fta: number;
  orb: number;
  trb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
}

function uPer(line: PerLine): number {
  const t = leagueAstFg;
  return (
    (1 / line.mp) *
    (line.tp +
      (2 / 3) * line.ast +
      (2 - leagueFactor * t) * line.fg +
      line.ft * 0.5 * (1 + (1 - t) + (2 / 3) * t) -
      leaguePtsPerPoss * line.tov -
      leaguePtsPerPoss * leagueOrbPct * (line.fga - line.fg) -
      leaguePtsPerPoss * 0.44 * (0.44 + 0.56 * leagueOrbPct) * (line.fta - line.ft) +
      leaguePtsPerPoss * (1 - leagueOrbPct) * (line.trb - line.orb) +
      leaguePtsPerPoss * leagueOrbPct * line.orb +
      leaguePtsPerPoss * line.stl +
      leaguePtsPerPoss * leagueOrbPct * line.blk -
      line.pf * (PER_LEAGUE.ft / PER_LEAGUE.pf - 0.44 * (PER_LEAGUE.fta / PER_LEAGUE.pf) * leaguePtsPerPoss)
    )
  );
}

const leagueUPer = uPer(PER_LEAGUE);

function perFor(line: PerLine): number {
  return uPer(line) * (15 / leagueUPer);
}

function teamStrength(short: string, table: TeamTable): number {
  const row = table[short] ?? { off: 68, def: 65 };
  const v = (row.off + row.def) / 200;
  return clamp(0.2 + ((v - 0.59) / 0.24) * 0.57, 0.13, 0.77);
}

function seriesProb(winProb: number, opponent: string, table: TeamTable): number {
  const s = teamStrength(opponent, table);
  const i = winProb + s - 2 * winProb * s;
  const u = 0.5 + ((i === 0 ? 0.5 : (winProb - winProb * s) / i) - 0.5) * 1.12;
  return clamp(u, 0.15, 0.85);
}

function playSeries(prob: number, rng: Rng): { won: boolean; wins: number; losses: number; games: string[] } {
  const games: string[] = [];
  let wins = 0;
  let losses = 0;
  while (wins < 4 && losses < 4) {
    const win = rng() < prob;
    if (win) wins++;
    else losses++;
    games.push(win ? 'W' : 'L');
  }
  return { won: wins === 4, wins, losses, games };
}

function buildStandings(
  wins: number,
  team: string,
  conference: 'east' | 'west',
  rng: Rng,
  table: TeamTable,
): { seed: number; standings: StandingRow[] } {
  const conferenceTeams = conference === 'east' ? EAST : WEST;
  const rows: StandingRow[] = conferenceTeams
    .filter((short) => short !== team)
    .map((short) => {
      const row = table[short] ?? { off: 68, def: 65 };
      const v = (row.off + row.def) / 200;
      const p = clamp(0.2 + ((v - 0.59) / 0.24) * 0.57 + uniform(rng, -0.06, 0.06), 0.13, 0.77);
      let teamWins = 0;
      for (let i = 0; i < 82; i++) if (rng() < p) teamWins++;
      return { short, wins: teamWins };
    });
  rows.push({ short: team, wins, isUs: true });
  rows.sort((a, b) => b.wins - a.wins || (a.isUs ? -1 : 1));
  return { seed: rows.findIndex((row) => row.isUs) + 1, standings: rows };
}

function playIn(seed: number, winProb: number, standings: StandingRow[], rng: Rng): PlayInRound {
  const at = (index: number): StandingRow => standings[index - 1] ?? { short: '???', wins: 35 };
  if (seed === 7 || seed === 8) {
    const opponent = at(seed === 7 ? 8 : 7);
    if (rng() < (seed === 7 ? winProb + 0.04 : winProb - 0.04)) {
      return {
        type: 'playin',
        advanced: true,
        newSeed: 7,
        games: ['W'],
        opponent,
        label: `Beat ${opponent.short} — Earned #7 Seed`,
      };
    }
    const second = at(9);
    const advanced = rng() < winProb - 0.03;
    return {
      type: 'playin',
      advanced,
      newSeed: advanced ? 8 : null,
      games: ['L', advanced ? 'W' : 'L'],
      opponent: advanced ? second : opponent,
      label: advanced ? 'Survived Play-In — Earned #8 Seed' : 'Eliminated in Play-In',
    };
  }
  const opponent = at(seed === 9 ? 10 : 9);
  if (!(rng() < winProb - 0.06)) {
    return { type: 'playin', advanced: false, newSeed: null, games: ['L'], opponent, label: 'Eliminated in Play-In' };
  }
  const second = at(seed === 9 ? 7 : 8);
  const advanced = rng() < winProb - 0.02;
  return {
    type: 'playin',
    advanced,
    newSeed: advanced ? 8 : null,
    games: ['W', advanced ? 'W' : 'L'],
    opponent: advanced ? second : opponent,
    label: advanced ? 'Survived Play-In — Earned #8 Seed' : 'Eliminated in Play-In',
  };
}

function playPlayoffs(
  seed: number,
  winProb: number,
  conference: 'east' | 'west',
  standings: StandingRow[],
  rng: Rng,
  table: TeamTable,
  finalsOpps: { east: string[]; west: string[] },
): { rounds: PlayoffRound[]; champion: boolean } {
  const rounds: PlayoffRound[] = [];
  let currentSeed = seed;
  if (currentSeed >= 7 && currentSeed <= 10) {
    const result = playIn(currentSeed, winProb, standings, rng);
    rounds.push(result);
    if (!result.advanced) return { rounds, champion: false };
    currentSeed = result.newSeed ?? 8;
  }
  const us = standings.find((row) => row.isUs)?.short;
  const at = (index: number): StandingRow => standings[index - 1] ?? { short: 'OPP', wins: 40 };
  const names = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'];
  const firstOpponentSeed = { 1: 8, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1 }[currentSeed] ?? 8;
  const matchup = (a: number, b: number): StandingRow & { seed: number } => {
    const left = at(a);
    const right = at(b);
    if (left.short === us) return { ...right, seed: b };
    if (right.short === us) return { ...left, seed: a };
    return rng() < seriesProb(teamStrength(left.short, table), right.short, table)
      ? { ...left, seed: a }
      : { ...right, seed: b };
  };
  let first: StandingRow & { seed: number };
  if ([1, 8].includes(currentSeed)) first = matchup(4, 5);
  else if ([4, 5].includes(currentSeed)) first = matchup(1, 8);
  else if ([2, 7].includes(currentSeed)) first = matchup(3, 6);
  else first = matchup(2, 7);
  let other: StandingRow & { seed: number };
  if ([1, 4, 5, 8].includes(currentSeed)) {
    const a = matchup(2, 7);
    const b = matchup(3, 6);
    other = rng() < seriesProb(teamStrength(a.short, table), b.short, table) ? a : b;
  } else {
    const a = matchup(1, 8);
    const b = matchup(4, 5);
    other = rng() < seriesProb(teamStrength(a.short, table), b.short, table) ? a : b;
  }
  const otherConference = conference === 'east' ? 'west' : 'east';
  const finalsShort = finalsOpps[otherConference][Math.floor(uniform(rng, 0, 3))] ?? 'BOS';
  const finalsWins = Math.round(uniform(rng, 52, 64));
  const opponents: Array<StandingRow & { seed?: number; isOtherConf?: boolean }> = [
    { ...at(firstOpponentSeed), seed: firstOpponentSeed },
    first,
    other,
    { short: finalsShort, wins: finalsWins, seed: 1, isOtherConf: true },
  ];
  let lost = false;
  for (let round = 0; round < 4 && !lost; round++) {
    const opponent = opponents[round] as StandingRow & { seed?: number; isOtherConf?: boolean };
    const prob = seriesProb(winProb, opponent.short, table);
    const series = playSeries(prob, rng);
    const entry: SeriesRound = {
      type: 'series',
      name: names[round] ?? 'Round',
      roundIndex: round,
      opponent,
      ...series,
    };
    rounds.push(entry);
    if (!series.won) lost = true;
  }
  const seriesWins = rounds.filter((round): round is SeriesRound => round.type === 'series' && round.won).length;
  return { rounds, champion: !lost && seriesWins === 4 };
}

function displayAwards(
  result: Pick<SeasonResult, 'ppg' | 'rpg' | 'apg' | 'spg' | 'bpg' | 'ovr' | 'team'>,
  era: 'current' | 'alltime',
  playerName: string,
  rng: Rng,
): { mvp: AwardWinner; dpoy: AwardWinner } {
  const draw = (min: number, max: number) => parseFloat((min + rng() * (max - min)).toFixed(1));
  const score = (ppg: number, rpg: number, apg: number) => ppg * 2 + rpg + 1.5 * apg;
  const candidates = (era === 'alltime' ? DISPLAY_MVP_ALLTIME : DISPLAY_MVP_CURRENT).map((entry) => ({
    name: entry.name,
    short: entry.short,
    team: entry.team,
    ppg: draw(entry.ppg[0] as number, entry.ppg[1] as number),
    rpg: draw(entry.rpg[0] as number, entry.rpg[1] as number),
    apg: draw(entry.apg[0] as number, entry.apg[1] as number),
  }));
  const best = Math.max(...candidates.map((entry) => score(entry.ppg, entry.rpg, entry.apg)));
  const playerScore = score(result.ppg, result.rpg, result.apg);
  const player: AwardWinner = {
    name: playerName,
    short: playerName,
    team: result.team,
    ppg: result.ppg,
    rpg: result.rpg,
    apg: result.apg,
    isPlayer: true,
  };
  let mvp: AwardWinner;
  if (playerScore >= best) {
    mvp = player;
  } else {
    const pool = [...candidates, player].map((entry) => ({
      ...entry,
      w: Math.pow(Math.max(0, score(entry.ppg ?? 0, entry.rpg ?? 0, entry.apg ?? 0)), 2.5),
    }));
    const total = pool.reduce((sum, entry) => sum + entry.w, 0);
    let ticket = rng() * total;
    mvp = pool[0] as AwardWinner;
    for (const entry of pool) {
      ticket -= entry.w;
      if (ticket <= 0) {
        mvp = entry;
        break;
      }
    }
  }
  let dpoy: AwardWinner;
  if (result.ovr >= 80 && result.bpg >= 2.8 && result.spg >= 1.5) {
    dpoy = { name: playerName, short: playerName, team: result.team, spg: result.spg, bpg: result.bpg, isPlayer: true };
  } else if (era === 'alltime') {
    const pick = DISPLAY_DPOY_ALLTIME[Math.floor(rng() * DISPLAY_DPOY_ALLTIME.length)] ?? DISPLAY_DPOY_ALLTIME[0]!;
    dpoy = {
      name: pick.name,
      short: pick.short,
      team: pick.team,
      spg: draw(pick.spg[0] as number, pick.spg[1] as number),
      bpg: draw(pick.bpg[0] as number, pick.bpg[1] as number),
    };
  } else {
    const pick = DISPLAY_DPOY_CURRENT;
    dpoy = {
      name: pick.name,
      short: pick.short,
      team: pick.team,
      spg: draw(pick.spg[0] as number, pick.spg[1] as number),
      bpg: draw(pick.bpg[0] as number, pick.bpg[1] as number),
    };
  }
  return { mvp, dpoy };
}

export function goatRank(
  result: Pick<SeasonResult, 'ovr' | 'ppg' | 'rpg' | 'apg' | 'spg' | 'bpg' | 'champion'>,
  mvp: AwardWinner,
  dpoy: AwardWinner,
): number | null {
  if (result.ovr < 92) return null;
  const isMvp = Boolean(mvp.isPlayer);
  const isDpoy = Boolean(dpoy.isPlayer);
  const base = Math.round(75 - ((result.ovr - 92) / 7) * 68);
  const bonusRaw =
    Math.max(0, result.ppg - 24) * 0.5 +
    Math.max(0, result.rpg - 9) * 0.4 +
    Math.max(0, result.apg - 7) * 0.4 +
    Math.max(0, result.spg - 1.8) * 0.8 +
    Math.max(0, result.bpg - 1.8) * 0.8;
  const bonus = Math.min(8, Math.round(bonusRaw * 1.2));
  let rank = base - bonus - (result.champion ? 2 : 0) - (isMvp ? 4 : 0) - (isDpoy ? 2 : 0);
  if (!result.champion) rank = Math.max(rank, 10);
  if (rank <= 3 && !(result.champion && result.ovr >= 97)) rank = 4;
  if (rank <= 2 && !(isMvp && result.champion && result.ovr >= 97)) rank = 3;
  if (rank <= 1 && !(isMvp && result.champion && result.ovr >= 99)) rank = 2;
  return Math.max(1, Math.min(75, rank));
}

export interface SeasonOptions {
  build: Build;
  team: string;
  playerName: string;
  rng?: Rng;
  displayRng?: Rng;
}

export function simulateSeason(options: SeasonOptions): SeasonResult {
  const { build, team, playerName } = options;
  const rng = options.rng ?? Math.random;
  const displayRng = options.displayRng ?? Math.random;
  const position = build.position;
  const allTime = build.era === 'alltime';
  const table = allTime ? ALLTIME_TEAMS : CURRENT_TEAMS;
  const finalsOpps = allTime ? ALLTIME_FINALS_OPPS : CURRENT_FINALS_OPPS;
  const ovr = computeOvr(build.picks, position);
  const row = table[team] ?? { off: 68, def: 65 };
  const off = row.off;
  const def = row.def;
  const v = (off + def) / 200;
  const base = clamp(0.2 + ((v - 0.59) / 0.24) * 0.57, 0.13, 0.77);
  const classic = !allTime;
  const strength = classic ? 0.5 + (base - 0.5) * 0.8 : base;
  const boost = (ovr - 82) / 17;
  const eraFactor = allTime ? 0.45 : 1;
  const boostValue = boost >= 0
    ? Math.min(allTime ? 0.09 : classic ? 0.3 : 0.2, boost * (classic ? 0.32 : 0.2) * eraFactor)
    : Math.max(allTime ? -0.05 : -0.1, boost * 0.1 * eraFactor);
  const winProb = Math.min(allTime ? 0.91 : 0.87, Math.max(0.12, strength + boostValue));

  const attrs: Record<string, number> = {};
  for (const [attr, pick] of Object.entries(build.picks)) attrs[attr] = pick.val;
  const get = (attr: string) => attrs[attr] ?? 5;
  const js = get('jumpShot');
  const fin = get('finishing');
  const pm = get('playmaking');
  const hnd = get('handles');
  const pas = get('passing');
  const intD = get('interiorDefense');
  const reb = get('rebounding');
  const perD = get('perimeterDefense');
  const spd = get('speed');
  const bnc = get('bounce');
  const size = get('size');
  const iq = get('basketballIQ');
  const clutch = get('clutch');
  const big = position === 'big';

  const scoring = big ? fin * 0.5 + js * 0.25 + pm * 0.15 + clutch * 0.1 : js * 0.32 + fin * 0.24 + spd * 0.18 + size * 0.12 + hnd * 0.08 + clutch * 0.06;
  const rebound = big ? reb * 0.55 + size * 0.3 + bnc * 0.1 + iq * 0.05 : size * 0.6 + bnc * 0.4;
  const pass = big ? pm * 0.5 + iq * 0.35 + pas * 0.15 : pas * 0.5 + iq * 0.35 + hnd * 0.15;
  const block = big ? size * 0.55 + intD * 0.28 + bnc * 0.1 + iq * 0.07 : size * 0.45 + perD * 0.35 + bnc * 0.12 + iq * 0.08;
  const steal = big ? perD * 0.35 + iq * 0.35 + spd * 0.3 : perD * 0.55 + iq * 0.35 + spd * 0.1;

  const ppg = round1(Math.max(big ? 5 : 4, (big ? -2 : -3.5) + uniform(rng, -1, 1) + scoring * (big ? 3.5 : 4)));
  const rpg = round1(Math.max(big ? 5 : 1.5, (big ? 4 : 0.5) + uniform(rng, -0.4, 0.4) + rebound * (big ? 0.82 : 0.75)));
  const assistBase = pass >= 8 ? Math.max(0.5, 0.125 * pass * pass - 0.375 * pass) : (3.8 * pass + 4.6) / 7;
  const apg = round1(Math.max(big ? 0.5 : 1, (big ? assistBase : -1 + pass * 1.1) + uniform(rng, -0.3, 0.3)));
  const spg = round1(Math.max(0.2, steal * 0.21 + uniform(rng, -0.1, 0.14)));
  const bpg = round1(Math.max(big ? 0.4 : 0, (big ? 0.2 : 0) + uniform(rng, -0.08, 0.15) + block * (big ? 0.27 : 0.13)));
  const fgPct = Math.min(
    big ? 63 : 53,
    Math.max(
      big ? 42 : 38,
      Math.round(
        (big ? 42 : 38) +
          uniform(rng, -2, 2) +
          (big ? fin * 0.95 + js * 0.33 + size * 0.24 + iq * 0.16 : js * 0.45 + fin * 0.38 + hnd * 0.18 + iq * 0.13),
      ),
    ),
  );
  const threePct = js === 0
    ? 0
    : Math.min(
        big ? 41 : 45,
        Math.max(
          0,
          Math.round((big ? 12 : 15) + uniform(rng, -2, 2) + js * 2.25 + (js >= 2 ? 3 : 0) + iq * 0.25 + spd * 0.15 + size * 0.1),
        ),
      );
  const ftPct = Math.min(99, Math.max(52, Math.round(52 + uniform(rng, -3, 3) + js * 2.8 + iq * 1.2 + (big ? 0 : hnd * 0.5))));
  uniform(rng, -1, 1);
  const tovBase = big ? 2 - ((pm + iq) / 2) * 0.18 + ppg * 0.04 : 2.6 - ((hnd + pas + iq) / 3) * 0.24 + ppg * 0.05;
  const tov = round1(Math.max(0.5, Math.min(5.5, tovBase + uniform(rng, -0.4, 0.4))));
  const threeRate = js === 0 ? 0 : Math.min(0.62, big ? 0.03 + js * 0.03 : 0.18 + js * 0.03);
  const ftRate = (big ? 0.2 : 0.14) + fin * 0.015;
  const fgaBase = 2 * (fgPct / 100) + threeRate * (threePct / 100) + ftRate * (ftPct / 100);
  const fga = fgaBase > 0 ? ppg / fgaBase : 0;
  const per = round1(
    Math.max(
      0,
      perFor({
        mp: 34,
        fg: fga * (fgPct / 100),
        fga,
        tp: fga * threeRate * (threePct / 100),
        ft: fga * ftRate * (ftPct / 100),
        fta: fga * ftRate,
        orb: rpg * (big ? 0.24 : 0.12),
        trb: rpg,
        ast: apg,
        stl: spg,
        blk: bpg,
        tov,
        pf: big ? 2.8 : 2.1,
      }),
    ),
  );

  let wins = 0;
  let losses = 0;
  const games: GameLine[] = [];
  const gameLog: string[] = [];
  let bestGame: GameLine | null = null;
  const opponents = [...EAST, ...WEST].filter((short) => short !== team);
  for (let index = 0; index < 82; index++) {
    const won = rng() < winProb;
    if (won) wins++;
    else losses++;
    gameLog.push(won ? 'W' : 'L');
    const scoreBase = 94 + Math.floor(rng() * 22);
    const margin = 3 + Math.floor(rng() * 17);
    const mySc = won ? scoreBase + margin : scoreBase;
    const oppSc = won ? scoreBase : scoreBase + margin;
    const opponent = opponents[Math.floor(rng() * opponents.length)] ?? 'BOS';
    const pts = Math.max(0, Math.round(ppg + uniform(rng, -7, 10)));
    const reb = Math.max(0, Math.round(rpg + uniform(rng, -3, 3)));
    const ast = Math.max(0, Math.round(apg + uniform(rng, -2, 2.5)));
    const home = rng() < 0.5;
    const line: GameLine = { g: index + 1, won, home, opponent, mySc, oppSc, pts, reb, ast };
    games.push(line);
    if (!bestGame || pts > bestGame.pts) bestGame = line;
  }

  const conference: 'east' | 'west' = EAST_SET.has(team) ? 'east' : 'west';
  const { seed, standings } = buildStandings(wins, team, conference, rng, table);
  let playoffRounds: PlayoffRound[] = [];
  let champion = false;
  if (seed <= 10) {
    const playoffProb = Math.min(allTime ? 0.89 : 0.85, winProb + 0.04);
    const result = playPlayoffs(seed, playoffProb, conference, standings, rng, table, finalsOpps);
    playoffRounds = result.rounds;
    champion = result.champion;
  }
  const playInRound = playoffRounds.find((round): round is PlayInRound => round.type === 'playin');
  const madePlayoffs = seed <= 6 || (seed <= 10 && playInRound?.advanced === true);

  const awardScore = (points: number, assists: number, boards: number) => points + assists * 1.5 + boards * 0.75;
  const playerScore = awardScore(ppg, apg, rpg);
  const benchmarks = (allTime ? MVP_BENCHMARKS_ALLTIME : MVP_BENCHMARKS_CURRENT).map(([pMin, pSpan, aMin, aSpan, rMin, rSpan]) =>
    awardScore(
      (pMin as number) + rng() * (pSpan as number),
      (aMin as number) + rng() * (aSpan as number),
      (rMin as number) + rng() * (rSpan as number),
    ),
  );
  const mvp = madePlayoffs && playerScore > Math.max(...benchmarks);
  const dpoyScore = spg * 10 + bpg * 8 + (seed <= 4 ? 4 : seed <= 8 ? 2 : 0);
  const dpoyThreshold = 26 + rng() * 10;
  const dpoy = dpoyScore >= dpoyThreshold && !mvp;
  const finalsRound = playoffRounds.find((round): round is SeriesRound => round.type === 'series' && round.roundIndex === 3);
  const finalsOpp = finalsRound?.opponent.short ?? null;
  const finalsSeries = finalsRound ? `${finalsRound.wins}-${finalsRound.losses}` : null;

  const display = displayAwards(
    { ppg, rpg, apg, spg, bpg, ovr, team },
    build.era,
    playerName,
    displayRng,
  );
  const rank = goatRank({ ovr, ppg, rpg, apg, spg, bpg, champion }, display.mvp, display.dpoy);

  return {
    ovr,
    wins,
    losses,
    position,
    ppg,
    rpg,
    apg,
    spg,
    bpg,
    tov,
    fgPct,
    threePct,
    ftPct,
    per,
    games,
    gameLog,
    bestGame,
    conference,
    seed,
    madePlayoffs,
    standings,
    playoffRounds,
    champion,
    team,
    mvp,
    dpoy,
    finalsOpp,
    finalsSeries,
    displayMvp: display.mvp,
    displayDpoy: display.dpoy,
    goatRank: rank,
  };
}
