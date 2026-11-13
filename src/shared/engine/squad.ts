import {
  ALLTIME_FINALS_OPPS,
  ALLTIME_TEAMS,
  CURRENT_FINALS_OPPS,
  CURRENT_TEAMS,
  EAST,
  EAST_SET,
  WEST,
} from './rules.js';
import { mulberry32, seededRng, type Rng } from './rng.js';
import { ovrFromValues } from './ovr.js';
import type { Player, Position } from './types.js';

export interface SquadSlot {
  id: string;
  pos: Position;
  label: string;
}

export const SQUAD_SLOTS: SquadSlot[] = [
  { id: 'PG', pos: 'guard', label: 'PG' },
  { id: 'SG', pos: 'guard', label: 'SG' },
  { id: 'SF', pos: 'guard', label: 'SF' },
  { id: 'PF', pos: 'big', label: 'PF' },
  { id: 'C', pos: 'big', label: 'C' },
];

const SQUAD_CAPS: Record<Position, number> = { guard: 3, big: 2 };

const SQUAD_REPLACEMENT = 64;

const SQUAD_MOVE: Record<Position, { off: number; def: number }> = {
  guard: { off: 0.45, def: 0.15 },
  big: { off: 0.25, def: 0.35 },
};

export interface SquadStarter {
  name: string;
  ovr: number;
  starter: boolean;
  pos: Position;
}

export function squadStarters(team: string, guards: Player[], bigs: Player[]): SquadStarter[] {
  const pools: Record<Position, Player[]> = { guard: guards, big: bigs };
  const taken = new Set<string>();
  const out: SquadStarter[] = [];
  for (const pos of ['big', 'guard'] as Position[]) {
    const ranked = (pools[pos] ?? [])
      .filter((player) => player.team === team && player.attrs && !taken.has(player.name))
      .map((player) => ({
        name: player.name,
        pos,
        starter: Boolean(player.starter),
        ovr: ovrFromValues(player.attrs, pos),
      }))
      .sort((a, b) => Number(b.starter) - Number(a.starter) || b.ovr - a.ovr);
    const list = ranked.slice(0, SQUAD_CAPS[pos]).sort((a, b) => b.ovr - a.ovr);
    for (const entry of list) taken.add(entry.name);
    out.push(...list);
  }
  return out;
}

export interface SquadBuild {
  pos: Position;
  values: Record<string, number>;
}

export interface SquadStrength {
  off: number;
  def: number;
  baseOff: number;
  baseDef: number;
  moves: { pos: Position; delta: number }[];
}

export function squadStrength(
  team: string,
  starters: SquadStarter[],
  builds: SquadBuild[],
  era: 'current' | 'alltime' = 'current',
): SquadStrength {
  const table = (era === 'alltime' ? ALLTIME_TEAMS : CURRENT_TEAMS) as Record<string, { off: number; def: number }>;
  const base = table[team] ?? { off: 68, def: 65 };
  let off = base.off;
  let def = base.def;
  const moves: { pos: Position; delta: number }[] = [];
  for (const pos of ['guard', 'big'] as Position[]) {
    const mine = builds.filter((build) => build.pos === pos);
    if (!mine.length) continue;
    const cap = SQUAD_CAPS[pos];
    const pushed = starters.filter((entry) => entry.pos === pos).map((entry) => ({ ovr: entry.ovr }));
    while (pushed.length < cap) pushed.push({ ovr: SQUAD_REPLACEMENT });
    const out = pushed.slice(Math.max(0, cap - mine.length));
    const delta =
      mine.reduce((sum, build) => sum + ovrFromValues(build.values, pos), 0) -
      out.reduce((sum, entry) => sum + entry.ovr, 0);
    off += delta * SQUAD_MOVE[pos].off;
    def += delta * SQUAD_MOVE[pos].def;
    moves.push({ pos, delta });
  }
  const clamp = (value: number) => Math.round(Math.min(99, Math.max(40, value)) * 10) / 10;
  return { off: clamp(off), def: clamp(def), baseOff: base.off, baseDef: base.def, moves };
}

export interface SquadRound {
  type: 'playin' | 'series';
  name: string | null;
  opponent: string | null;
  wins: number | null;
  losses: number | null;
  won: boolean;
  label: string | null;
}

export interface SquadSeasonResult {
  seed: string;
  wins: number;
  losses: number;
  seedNumber: number;
  conference: 'east' | 'west';
  champion: boolean;
  madePlayoffs: boolean;
  winProb: number;
  log: string;
  rounds: SquadRound[];
}

interface StandingRow {
  short: string;
  wins: number;
  isUs: boolean;
}

function teamWinProb(short: string, ratings: Record<string, { off: number; def: number }>): number {
  const row = ratings[short] ?? { off: 68, def: 65 };
  const score = (row.off + row.def) / 200;
  return Math.max(0.13, Math.min(0.77, 0.2 + ((score - 0.59) / 0.24) * 0.57));
}

function matchupProb(myProb: number, opponent: string, ratings: Record<string, { off: number; def: number }>): number {
  const oppProb = teamWinProb(opponent, ratings);
  const denom = myProb + oppProb - 2 * myProb * oppProb;
  const raw = denom === 0 ? 0.5 : (myProb - myProb * oppProb) / denom;
  return Math.min(0.85, Math.max(0.15, 0.5 + (raw - 0.5) * 1.12));
}

function playSeries(winProb: number, rand: Rng): { won: boolean; wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  while (wins < 4 && losses < 4) {
    if (rand() < winProb) wins++;
    else losses++;
  }
  return { won: wins === 4, wins, losses };
}

function playIn(
  seed: number,
  standings: StandingRow[],
  winProb: number,
  rand: Rng,
): { advanced: boolean; newSeed: number; opponent: string; label: string; games: string[] } {
  const get = (index: number) => standings[index - 1] ?? { short: '???', wins: 35, isUs: false };
  if (seed === 7 || seed === 8) {
    const peer = get(seed === 7 ? 8 : 7);
    const first = rand() < (seed === 7 ? winProb + 0.04 : winProb - 0.04);
    if (first) {
      return { advanced: true, newSeed: 7, opponent: peer.short, label: `Beat ${peer.short} — Earned #7 Seed`, games: ['W'] };
    }
    const survivor = get(9);
    const second = rand() < winProb - 0.03;
    return {
      advanced: second,
      newSeed: second ? 8 : 0,
      opponent: second ? survivor.short : peer.short,
      label: second ? 'Survived Play-In — Earned #8 Seed' : 'Eliminated in Play-In',
      games: second ? ['L', 'W'] : ['L', 'L'],
    };
  }
  const peer = get(seed === 9 ? 10 : 9);
  const first = rand() < winProb - 0.06;
  if (!first) {
    return { advanced: false, newSeed: 0, opponent: peer.short, label: 'Eliminated in Play-In', games: ['L'] };
  }
  const lower = get(seed === 9 ? 7 : 8);
  const second = rand() < winProb - 0.02;
  return {
    advanced: second,
    newSeed: second ? 8 : 0,
    opponent: second ? lower.short : peer.short,
    label: second ? 'Survived Play-In — Earned #8 Seed' : 'Eliminated in Play-In',
    games: second ? ['W', 'W'] : ['W', 'L'],
  };
}

export function squadSeason(
  seedString: string,
  team: string,
  strength: { off: number; def: number },
  era: 'current' | 'alltime' = 'current',
): SquadSeasonResult {
  const ratings = (era === 'alltime' ? ALLTIME_TEAMS : CURRENT_TEAMS) as Record<string, { off: number; def: number }>;
  const elite = era === 'alltime' ? ALLTIME_FINALS_OPPS : CURRENT_FINALS_OPPS;
  const intSeed = Math.floor(seededRng(seedString)() * 4294967295);
  const rand = mulberry32(intSeed);
  const score = (strength.off + strength.def) / 200;
  const winProb = Math.max(0.13, Math.min(0.87, 0.2 + ((score - 0.59) / 0.24) * 0.57));
  let wins = 0;
  let losses = 0;
  const log: string[] = [];
  for (let i = 0; i < 82; i++) {
    const won = rand() < winProb;
    if (won) wins++;
    else losses++;
    log.push(won ? 'W' : 'L');
    rand();
    rand();
    rand();
    rand();
  }
  const conference: 'east' | 'west' = EAST_SET.has(team) ? 'east' : 'west';
  const league = (conference === 'east' ? EAST : WEST).filter((short) => short !== team);
  const rows: StandingRow[] = league.map((short) => {
    const row = ratings[short] ?? { off: 68, def: 65 };
    const base = Math.max(0.13, Math.min(0.77, 0.2 + (((row.off + row.def) / 200 - 0.59) / 0.24) * 0.57 + (rand() * 0.12 - 0.06)));
    let count = 0;
    for (let i = 0; i < 82; i++) if (rand() < base) count++;
    return { short, wins: count, isUs: false };
  });
  rows.push({ short: team, wins, isUs: true });
  rows.sort((a, b) => b.wins - a.wins || (a.isUs ? -1 : 1));
  const seedNumber = rows.findIndex((row) => row.isUs) + 1;
  const get = (index: number) => rows[index - 1] ?? { short: 'OPP', wins: 40, isUs: false };
  const rounds: SquadRound[] = [];
  let champion = false;
  let madePlayoffs = seedNumber <= 6;
  if (seedNumber <= 10) {
    let currentSeed = seedNumber;
    let advanced = true;
    if (currentSeed >= 7) {
      const result = playIn(currentSeed, rows, Math.min(0.85, winProb + 0.04), rand);
      rounds.push({
        type: 'playin',
        name: 'Play-In',
        opponent: result.opponent,
        wins: result.games.filter((game) => game === 'W').length,
        losses: result.games.filter((game) => game === 'L').length,
        won: result.advanced,
        label: result.label,
      });
      advanced = result.advanced;
      currentSeed = result.newSeed || currentSeed;
    }
    madePlayoffs = seedNumber <= 6 || advanced;
    if (advanced) {
      const playoffProb = Math.min(0.85, winProb + 0.04);
      const roundNames = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'];
      const firstRoundMap: Record<number, number> = { 1: 8, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1 };
      const pair = (seedA: number, seedB: number) => {
        const teamA = get(seedA);
        const teamB = get(seedB);
        if (teamA.short === team) return { short: teamB.short, seed: seedB };
        if (teamB.short === team) return { short: teamA.short, seed: seedA };
        return rand() < matchupProb(teamWinProb(teamA.short, ratings), teamB.short, ratings)
          ? { short: teamA.short, seed: seedA }
          : { short: teamB.short, seed: seedB };
      };
      const secondRound = [1, 8].includes(currentSeed)
        ? pair(4, 5)
        : [4, 5].includes(currentSeed)
          ? pair(1, 8)
          : [2, 7].includes(currentSeed)
            ? pair(3, 6)
            : pair(2, 7);
      let thirdRound: { short: string; seed: number };
      if ([1, 4, 5, 8].includes(currentSeed)) {
        const first = pair(2, 7);
        const other = pair(3, 6);
        thirdRound = rand() < matchupProb(teamWinProb(first.short, ratings), other.short, ratings) ? first : other;
      } else {
        const first = pair(1, 8);
        const other = pair(4, 5);
        thirdRound = rand() < matchupProb(teamWinProb(first.short, ratings), other.short, ratings) ? first : other;
      }
      const otherConference = conference === 'east' ? 'west' : 'east';
      const field = elite[otherConference];
      const finalsOpponent = field[Math.floor(rand() * 3)] ?? 'BOS';
      void Math.round(52 + rand() * 12);
      const firstOpponent = get(firstRoundMap[currentSeed] ?? 8);
      const matchups = [
        { short: firstOpponent.short, seed: firstRoundMap[currentSeed] ?? 8 },
        secondRound,
        thirdRound,
        { short: finalsOpponent, seed: 1 },
      ];
      let eliminated = false;
      for (let round = 0; round < 4; round++) {
        if (eliminated) break;
        const opponent = matchups[round] as { short: string; seed: number };
        const result = playSeries(matchupProb(playoffProb, opponent.short, ratings), rand);
        rounds.push({
          type: 'series',
          name: roundNames[round] ?? null,
          opponent: opponent.short,
          wins: result.wins,
          losses: result.losses,
          won: result.won,
          label: null,
        });
        if (!result.won) eliminated = true;
      }
      champion = !eliminated;
    }
  }
  return { seed: seedString, wins, losses, seedNumber, conference, champion, madePlayoffs, winProb, log: log.join(''), rounds };
}

export function honorScore(line: { ppg: number; rpg: number; apg: number; spg: number; bpg: number }, wins: number): number {
  return line.ppg + 1.2 * line.rpg + 1.5 * line.apg + 2 * (line.spg + line.bpg) + (wins - 41) * 0.08;
}

export function honorsFor(
  lines: { id: string; ppg: number; rpg: number; apg: number; spg: number; bpg: number }[],
  wins: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  const ranked = lines.map((line) => ({ line, score: honorScore(line, wins) })).sort((a, b) => b.score - a.score);
  let allNba = 0;
  let honors = 0;
  for (const entry of ranked) {
    let honor: string | null =
      entry.score >= 50 ? 'AN1' : entry.score >= 45 ? 'AN2' : entry.score >= 41 ? 'AN3' : entry.score >= 35 ? 'AS' : null;
    if (honor?.startsWith('AN') && allNba >= 2) honor = 'AS';
    if (honor && honors >= 4) honor = null;
    if (honor) {
      out[entry.line.id] = honor;
      honors++;
      if (honor.startsWith('AN')) allNba++;
    }
  }
  return out;
}
