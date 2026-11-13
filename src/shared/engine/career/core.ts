import { clamp, seededRng, type Rng } from '../rng';
import { ovrFromValues } from '../ovr';
import type { Position, Team } from '../types';
import * as K from './rules';

export const r10 = (v: number) => Math.round(v * 10) / 10;
export const hashN = (s: string) => {
  let h = 7;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
};
export const byOvr = (a: { ovr: number }, b: { ovr: number }) => b.ovr - a.ovr;

export interface Trait {
  val: number;
  wear?: number;
  slipY?: number;
  workY?: number;
  faded?: number;
  upgraded?: number;
  grew?: number;
}

export type Traits = Record<string, Trait>;

export interface RosterPlayer {
  name: string;
  pos: Position;
  ovr: number;
  age: number;
  rookie?: boolean;
  from?: string | null;
}

export interface Roster {
  team: string;
  guard: RosterPlayer[];
  big: RosterPlayer[];
}

export interface CareerTeam {
  short: string;
  name: string;
  color: string;
  color2: string;
  off: number;
  def: number;
  conf: 'east' | 'west';
}

export interface Fit {
  short: string;
  name: string;
  color: string;
  color2: string;
  off: number;
  def: number;
  conf: 'east' | 'west';
  backcourt: number;
  frontcourt: number;
  bench: number;
  adj: number;
  need: number;
}

export interface Drill {
  id: K.DrillId;
  label: string;
  trait: string;
  score: number | null;
  text: string | null;
  pct: number | null;
}

export interface Interview {
  who: string;
  q: string;
  a: { t: string; stock: number; persona: string }[];
  team: string;
  answer: number | null;
}

export interface TickerPick {
  o: number;
  round: number;
  slot: number;
  team: string;
  player?: string;
  pos?: string;
  you?: boolean;
  trade?: boolean;
}

export interface DraftState {
  combine: Drill[];
  interviews: Interview[];
  picks: TickerPick[];
  pick: TickerPick | null;
  persona: string | null;
}

export interface GameLine {
  g: number;
  won: boolean;
  home: boolean;
  opponent: string;
  mySc: number;
  oppSc: number;
  pts: number;
  reb: number;
  ast: number;
  sat: boolean;
}

export interface Injury {
  kind: string;
  games: number;
  serious: boolean;
  at: number;
}

export interface InjuryRecord {
  year: number;
  at: number;
  kind: string;
  games: number;
  played: boolean;
  serious: boolean;
}

export type FeedItem =
  | { kind: 'note'; k: number; text: string }
  | { kind: 'games'; k: number; lines: string[]; headline: string | null }
  | { kind: 'injury'; k: number; text: string }
  | { kind: 'moment'; k: number; title: string; detail: string; hit?: boolean }
  | { kind: 'award'; k: number; text: string };

export interface Goal {
  k: string;
  label: string;
  n: number;
  met?: boolean;
}

export interface Round {
  name: string;
  opp: string;
  oppName: string;
  home: boolean | null;
  p: number;
  pw: number;
  played: boolean;
  won?: boolean;
  mySc?: number;
  oppSc?: number;
  series?: boolean;
  hit?: boolean | null;
  game?: string | null;
}

export interface PlayoffState {
  idx: number;
  rounds: Round[];
  line: Round[];
  stage: 'round' | 'done';
  won: boolean;
  out: boolean;
}

export interface FinalSeason {
  wins: number;
  losses: number;
  seed: number;
  standings: { short: string; wins: number; isUs: boolean }[];
  conference: 'east' | 'west';
}

export interface ActiveSeason {
  k: number;
  base: GameLine[];
  mods: Record<string, number>[];
  sat: number[];
  lines: GameLine[];
  feed: FeedItem[];
  injury: Injury | null;
  moment: { stop: number; game: string; title: string; trait: number; hit?: boolean } | null;
  benched: { weeks: number; behind: string; label: string } | null;
  goals: Goal[];
  seed: string;
  po: PlayoffState | null;
  final: FinalSeason | null;
  streak: { from: number; to: number; lean: number; label: string } | null;
}

export interface SeasonRoundRecord {
  round: string;
  opponent: string;
  won: boolean;
  mySc: number;
  oppSc: number;
  series: boolean;
}

export interface SeasonRecord {
  year: number;
  season: number;
  age: number;
  team: string;
  teamName: string;
  ovr: number;
  role: string;
  wins: number;
  losses: number;
  playoffs: boolean;
  champion: boolean;
  rounds: SeasonRoundRecord[];
  stats: { ppg: number; rpg: number; apg: number; spg: number; bpg: number; gp: number; pts: number; reb: number; ast: number };
  award: boolean;
  awardName: string;
  proBowl: boolean;
  allPro: boolean;
  roy?: boolean;
  fmvp?: boolean;
  goals: Goal[];
  missed: number;
  benched: number;
}

export interface CareerEvent {
  year: number;
  text: string;
  id?: string;
}

export interface Offer {
  team: string;
  fit: Fit;
  perYear: number;
  years: number;
  pitch: string;
  kind: 'stay' | 'contender' | 'payer' | 'late';
  stand: { starter: boolean; behind: string | null; label: string };
  noTrade?: boolean;
  starter?: boolean;
  base?: number;
}

export interface Talks extends Offer {
  patience: number;
  max: number;
  asked: string[];
  walked: boolean;
  lines: string[];
  noTrade: boolean;
  starter: boolean;
}

export interface Career {
  v: number;
  seed: string;
  pos: Position;
  name: string;
  games: K.GamesMode;
  build: Traits;
  base: Traits;
  ovr: number;
  age: number;
  year: number;
  season: number;
  phase: 'draft' | 'preseason' | 'season' | 'offseason' | 'retired';
  step: string | null;
  draft: DraftState;
  team: string | null;
  fit: Fit | null;
  roster: Roster | null;
  league: Record<string, { off: number; def: number }> | null;
  contract: K.Contract | null;
  role: string;
  lastRole: string | null;
  dev: { points: number; spent: number };
  durability: number;
  durBase: number;
  rep: number;
  injuries: InjuryRecord[];
  seasons: SeasonRecord[];
  events: CareerEvent[];
  decisions: { year: number; text: string }[];
  nextMods: { off?: number; def?: number } | null;
  goals: Goal[];
  active: ActiveSeason | null;
  offers: Offer[] | null;
  talks: Talks | null;
  hof: { in: boolean; pct: number; ballot: string } | null;
  retired: boolean;
  earnings: number;
  shoe: { tier: 'deal' | 'signature'; year: number; perYear: number } | null;
  legacyBonus: number;
  legacyCamp: number;
  bodyWork: number;
  kept: Record<string, { roster: Roster; yrs: number }>;
  dealt: Record<string, string>;
  gone: string[];
  off: { step: string; moves: string[]; news: string[]; camp: { won: boolean; bonus: number; score: number; game: string; legacy: number } | null; contract: boolean } | null;
  aging: string[] | null;
  updatedAt: number;
}

export interface Pools {
  guards: { name: string; team: string; attrs: Record<string, number> }[];
  bigs: { name: string; team: string; attrs: Record<string, number> }[];
}

export interface Ctx {
  teams: CareerTeam[];
  pools: Pools;
  birth: Record<string, number> | null;
}

// ── Teams ────────────────────────────────────────────────────────────────────
export function careerTeams(catalogTeams: Team[], ratings: Record<string, { off: number; def: number }>, east: Set<string>): CareerTeam[] {
  return catalogTeams.map((team) => {
    const r = ratings[team.short] ?? { off: 68, def: 65 };
    return {
      short: team.short,
      name: team.name,
      color: team.color,
      color2: team.color2,
      off: clamp(r10((r.off - 55) / 3.3), 1, 10),
      def: clamp(r10((r.def - 55) / 3.3), 1, 10),
      conf: east.has(team.short) ? ('east' as const) : ('west' as const),
    };
  });
}

export function teamOf(ctx: Ctx, short: string): CareerTeam {
  return ctx.teams.find((t) => t.short === short) ?? (ctx.teams[0] as CareerTeam);
}

export const groupLabel = (g: Position) => (g === 'guard' ? 'G' : 'F/C');

const avgOvr = (list: { ovr: number }[]) => {
  const values = list.map((p) => p?.ovr).filter(Number.isFinite);
  return values.length ? values.reduce((s, x) => s + x, 0) / values.length : 72;
};

// ── Rosters ──────────────────────────────────────────────────────────────────
export const RETIRE_AT: Record<string, number> = { guard: 38, big: 38 };
export const KEEP: Record<Position, number> = { guard: 5, big: 4 };
export const STARTERS: Record<Position, number> = { guard: 3, big: 2 };

const FIRSTS = [
  'Andre', 'Cameron', 'Dorian', 'Ellis', 'Franklin', 'Grady', 'Hollis', 'Isaac', 'Jonah', 'Keon',
  'Landon', 'Micah', 'Nolan', 'Omar', 'Preston', 'Reid', 'Silas', 'Tobias', 'Vernon', 'Wesley',
];
const LASTS = [
  'Abrams', 'Boone', 'Carver', 'Dunlap', 'Ellison', 'Fenn', 'Grady', 'Hobbs', 'Iverson', 'Jeffries',
  'Keller', 'Lockhart', 'Monroe', 'Nesbitt', 'Orton', 'Pruitt', 'Quill', 'Rowan', 'Sanders', 'Tolliver',
];

function rookieName(r: Rng): string {
  return `${FIRSTS[Math.floor(r() * FIRSTS.length)]} ${LASTS[Math.floor(r() * LASTS.length)]}`;
}

function freshName(r: Rng, taken: Set<string> | null): string {
  let n = rookieName(r);
  for (let i = 0; taken && taken.has(n) && i < 25; i++) n = rookieName(r);
  taken?.add(n);
  return n;
}

const poolOvr = (pos: Position, p: { attrs: Record<string, number> }) => ovrFromValues(p.attrs ?? {}, pos);

function ageOf(ctx: Ctx, name: string, yrs = 0): number {
  const born = ctx.birth?.[name];
  const base = born ? K.FIRST_SEASON - born : 23 + (hashN(name) % 6);
  return base + yrs;
}

function man(ctx: Ctx, pos: Position, p: { name: string; team: string; attrs: Record<string, number> }, yrs: number): RosterPlayer {
  return { name: p.name, pos, ovr: poolOvr(pos, p), age: ageOf(ctx, p.name, yrs), from: p.team };
}

const ageStep = (age: number, x: number) =>
  age <= 24 ? 1 + Math.floor(x * 4) : age <= 27 ? Math.floor(x * 3) : age <= 30 ? Math.floor(x * 3) - 1 : age <= 32 ? Math.floor(x * 3) - 2 : -1 - Math.floor(x * 4);

const grownOvr = (p: RosterPlayer, step: number) => (p.rookie && step > 0 && p.ovr >= 82 ? Math.max(p.ovr, Math.min(90, p.ovr + Math.ceil(step / 3))) : p.ovr + step);

function genPick(r: Rng, pos: Position, taken: Set<string>): RosterPlayer {
  const ovr = clamp(Math.round(73 + (r() + r() + r() - 1.5) * 12), 58, 88);
  return { name: freshName(r, taken), pos, ovr, age: 21 + Math.floor(r() * 2), rookie: true, from: null };
}

function placeGroup(pos: Position, list: RosterPlayer[], r: Rng): RosterPlayer[] {
  const taken = new Set(list.map((p) => p.name));
  const out = [...list];
  while (out.length < KEEP[pos]) out.push(genPick(r, pos, taken));
  return out.sort(byOvr).slice(0, KEEP[pos]);
}

function ageGroup(pos: Position, list: RosterPlayer[], r: Rng): RosterPlayer[] {
  const grown = list.map((p) => ({ ...p, age: p.age + 1, ovr: clamp(grownOvr(p, ageStep(p.age + 1, r())), 55, 99) }));
  const kept = grown.filter((p) => p.age < RETIRE_AT[pos]! && !(p.age >= RETIRE_AT[pos]! - 2 && r() < 0.35));
  return placeGroup(pos, kept, r);
}

export function makeRoster(ctx: Ctx, short: string, yrs = 0, gone: string[] = []): Roster {
  const r = seededRng(`${short}-bucket-fill`);
  const out = { team: short, guard: [], big: [] } as Roster;
  for (const pos of ['guard', 'big'] as Position[]) {
    const pool = (pos === 'guard' ? ctx.pools.guards : ctx.pools.bigs).filter((p) => p.team === short && !gone.includes(p.name));
    let list = placeGroup(pos, pool.map((p) => man(ctx, pos, p, 0)), r);
    for (let y = 1; y <= yrs; y++) list = ageGroup(pos, list, r);
    out[pos] = list;
  }
  return out;
}

export function depthChart(
  c: { name: string; pos: Position; ovr: number; age: number; rep: number; contractStarter?: boolean; lastRole?: string | null },
  roster: Roster,
): { all: (RosterPlayer & { you?: boolean })[]; idx: number; starters: number; starter: boolean; ahead: (RosterPlayer & { you?: boolean })[]; label: string } {
  const group = (roster[c.pos] ?? []).filter((p) => p.name !== c.name).sort(byOvr);
  const me = { name: c.name, pos: c.pos, ovr: c.ovr, age: c.age, you: true };
  const trust = c.rep >= 8 ? 1 : c.rep <= 3 ? -1 : 0;
  const edge = (p: { ovr: number; you?: boolean }) => p.ovr + (p.you ? (c.contractStarter ? 99 : ((c.lastRole === 'Starter' ? 2 : 0) + trust)) : 0);
  const all: (RosterPlayer & { you?: boolean })[] = [...group, me].sort((a, b) => edge(b) - edge(a));
  const idx = all.findIndex((p) => p.you);
  const starters = STARTERS[c.pos];
  return { all, idx, starters, starter: idx < starters, ahead: all.slice(0, idx), label: `${groupLabel(c.pos)} ${idx + 1}` };
}

export function teamFit(ctx: Ctx, short: string, pos: Position, roster: Roster, league: Record<string, { off: number; def: number }> | null, name: string | null): Fit {
  const t = teamOf(ctx, short);
  const guards = (roster.guard ?? []).filter((p) => p.name !== name).sort(byOvr).slice(0, 3);
  const bigs = (roster.big ?? []).filter((p) => p.name !== name).sort(byOvr).slice(0, 2);
  const vs = (list: RosterPlayer[], med: number, per: number) => (list.length ? r10(clamp(6 + (avgOvr(list) - med) * per, 1, 11)) : 1);
  const gG = vs(guards, 83, 0.75);
  const bG = vs(bigs, 80.5, 0.65);
  const five = new Set([...guards, ...bigs].map((p) => p.name));
  const bench = [...roster.guard, ...roster.big].filter((p) => p.name !== name).filter((p) => !five.has(p.name)).sort(byOvr).slice(0, 4);
  const benchG = vs(bench, 75.5, 1.6);
  const adj = pos === 'guard' ? (bG - 6) * 0.2 + (gG - 6) * 0.15 + (benchG - 6) * 0.1 : (gG - 6) * 0.25 + (bG - 6) * 0.1 + (benchG - 6) * 0.1;
  const need = pos === 'guard' ? 11 - gG : 11 - bG;
  const drift = league?.[short] ?? { off: 0, def: 0 };
  const off = clamp(r10(t.off + (Number.isFinite(drift.off) ? drift.off : 0)), 1, 10);
  const def = clamp(r10(t.def + (Number.isFinite(drift.def) ? drift.def : 0)), 1, 10);
  return {
    short,
    name: t.name,
    color: t.color,
    color2: t.color2,
    off,
    def,
    conf: t.conf,
    backcourt: gG,
    frontcourt: bG,
    bench: benchG,
    adj: clamp(Math.round(adj * 2) / 2, -1.5, 1.5),
    need,
  };
}

export const strength = (t: { off?: number; def?: number }) => ((t.off ?? 5) + (t.def ?? 5)) / 2;

export function simTeam(fit: Fit, mods: { off?: number; def?: number } | null, c: { ovr: number; bench: boolean; roster: Roster | null; name: string }) {
  const mates = [...(c.roster?.guard ?? []), ...(c.roster?.big ?? [])].filter((p) => p.name !== c.name);
  const best = Math.max(0, ...mates.map((p) => p.ovr));
  const usage = clamp((0.42 + (c.ovr - 70) * 0.012 - (best > c.ovr ? 0.06 : 0)) * (c.bench ? 0.62 : 1), 0.3, 0.75);
  const x = clamp((c.ovr - 82) / 17, 0, 1);
  const cost = 0.2 * x * (1 - x) + 0.02 * (1 - x) + clamp((86 - c.ovr) * 0.006, 0, 0.1);
  const bend = cost / 0.078;
  return {
    off: clamp(fit.off + fit.adj + (mods?.off ?? 0) - bend, 1, 10),
    def: clamp(fit.def + (mods?.def ?? 0) - bend, 1, 10),
    usage,
    bench: !!c.bench,
  };
}

// ── Team season ──────────────────────────────────────────────────────────────
export function teamWinProb(team: { off: number; def: number }, ovr: number): number {
  const tr = { off: 55 + team.off * 3.3, def: 55 + team.def * 3.3 };
  const score = (tr.off + tr.def) / 200;
  const baseWP = clamp(0.2 + ((score - 0.59) / 0.24) * 0.57, 0.13, 0.77);
  const rawDelta = (ovr - 82) / 17;
  const boost = rawDelta >= 0 ? Math.min(0.2, rawDelta * 0.2) : Math.max(-0.1, rawDelta * 0.1);
  return clamp(baseWP + boost, 0.12, 0.87);
}

export function teamSeason(seed: string, team: { off: number; def: number }, ovr: number, ctx: Ctx, teamShort: string): { games: GameLine[]; wins: number; losses: number; winProb: number } {
  const rand = seededRng(`${seed}-games`);
  const winProb = teamWinProb(team, ovr);
  const others = ctx.teams.map((t) => t.short).filter((s) => s !== teamShort);
  const games: GameLine[] = [];
  let wins = 0;
  let losses = 0;
  for (let i = 0; i < K.REGULAR_GAMES; i++) {
    const g = i + 1;
    const won = rand() < winProb;
    const home = rand() < 0.5;
    const opponent = others[Math.floor(rand() * others.length)] as string;
    const loserBase = 94 + Math.floor(rand() * 22);
    const margin = 3 + Math.floor(rand() * 17);
    if (won) wins++;
    else losses++;
    games.push({
      g,
      won,
      home,
      opponent,
      mySc: won ? loserBase + margin : loserBase,
      oppSc: won ? loserBase : loserBase + margin,
      pts: 0,
      reb: 0,
      ast: 0,
      sat: false,
    });
  }
  return { games, wins, losses, winProb };
}

export function conferenceStandings(ctx: Ctx, teamShort: string, conf: 'east' | 'west', myWins: number, seed: string): { rows: { short: string; wins: number; isUs: boolean }[]; seedNumber: number } {
  const rand = seededRng(`${seed}-standings`);
  const rows = ctx.teams
    .filter((t) => t.conf === conf && t.short !== teamShort)
    .map((t) => {
      const score = (t.off + t.def) / 200;
      const baseWP = clamp(0.2 + ((score - 0.59) / 0.24) * 0.57 + (rand() * 0.12 - 0.06), 0.13, 0.77);
      let wins = 0;
      for (let i = 0; i < K.REGULAR_GAMES; i++) if (rand() < baseWP) wins++;
      return { short: t.short, wins, isUs: false };
    });
  rows.push({ short: teamShort, wins: myWins, isUs: true });
  rows.sort((a, b) => b.wins - a.wins || (a.isUs ? -1 : 1));
  return { rows, seedNumber: rows.findIndex((r) => r.isUs) + 1 };
}

// ── Combine ──────────────────────────────────────────────────────────────────
export function drillValue(id: K.DrillId, v: number, score: number, raw: { made?: number; of?: number; secs?: number; reps?: number; inches?: number } | null, pos: Position): { text: string; pct: number } {
  const t = clamp(v, 0, 11) / 11;
  const run = score - 0.6;
  const cnt = (of: number, lo = 0) => (raw?.made != null ? raw.made : Math.round(lo + score * (of - lo)));
  const pc = (x: number) => clamp(x, -1, 1);
  switch (id) {
    case 'sprint': {
      const s = raw?.secs ?? K.dashTarget('sprint', pos, v) + 0.08 - run * 0.14;
      return { text: `${s.toFixed(2)}s`, pct: pc((K.dashTypical('sprint', pos) - s) / 0.15) };
    }
    case 'lane': {
      const of = raw?.of ?? 6;
      const slips = of - cnt(of, 2);
      const s = raw?.secs ?? 11.9 - t * 1.4 + slips * 0.12 - run * 0.15;
      return { text: `${s.toFixed(2)}s`, pct: pc((11.2 - s) / 0.6) };
    }
    case 'spot': {
      const of = raw?.of ?? 4;
      const m = cnt(of);
      return { text: `${m} of ${of} made`, pct: pc((m / of - 0.5) * 2.2) };
    }
    case 'vert': {
      const i = raw?.inches ?? r10(26 + t * 16 + run * 7);
      return { text: `${i}" vertical`, pct: pc((i - 33) / 6) };
    }
    case 'nbench': {
      const typ = K.benchTypical(pos);
      const n = raw?.reps ?? Math.round(typ * (0.45 + score * 1.1));
      return { text: `${n} reps`, pct: pc((n - typ) / 6) };
    }
  }
}

export function combineDrills(pos: Position): Drill[] {
  return K.COMBINE[pos].map((spec) => ({ id: spec.id, label: spec.label, trait: spec.trait, score: null, text: null, pct: null }));
}

export function recordCombine(c: Career, id: K.DrillId, score: number): Career {
  const combine = c.draft.combine.map((d) => (d.id === id ? { ...d, score, ...drillValue(d.id, c.build[d.trait]?.val ?? 5, score, null, c.pos) } : d));
  return { ...c, draft: { ...c.draft, combine } };
}

export function skipCombine(c: Career): Career {
  const combine = c.draft.combine.map((d) => (d.score != null ? d : { ...d, score: 0.3, ...drillValue(d.id, Math.min(c.build[d.trait]?.val ?? 5, 3), 0.3, null, c.pos) }));
  return { ...c, draft: { ...c.draft, combine } };
}

export function pickLabel(overall: number): { round: number; slot: number } {
  const round = Math.ceil(overall / K.TEAMS_PER_LEAGUE);
  return { round, slot: overall - (round - 1) * K.TEAMS_PER_LEAGUE };
}

export function stockOf(c: { ovr: number; draft: { combine: Drill[]; interviews: Interview[] } }): { lo: number; hi: number; shift: number } {
  const [lo0raw, hi0raw] = K.stockRange(c.ovr);
  const lo0 = clamp(lo0raw, 1, K.MAX_PICK);
  const hi0 = clamp(hi0raw, 1, K.MAX_PICK);
  const mid = (lo0 + hi0) / 2;
  const span = 0.5 + mid * 0.08;
  const played = c.draft.combine.filter((x) => x.pct != null);
  const comb = played.length ? played.reduce((s, x) => s + (x.pct ?? 0), 0) / played.length : 0;
  const inter = (c.draft.interviews ?? []).reduce((s, x) => s + (x.answer != null ? (x.a[x.answer]?.stock ?? 0) : 0), 0);
  const shift = Math.round(-comb * span - inter * 0.6);
  const lo = clamp(lo0 + shift, 1, K.MAX_PICK);
  const hi = clamp(hi0 + shift, lo, K.MAX_PICK);
  return { lo, hi, shift };
}

export function draftOrder(ctx: Ctx, seed: string): string[] {
  const r = seededRng(`draft-${seed}`);
  return ctx.teams
    .map((t) => ({ ...t }))
    .sort((a, b) => a.off + a.def + r() * 3 - (b.off + b.def + r() * 3))
    .map((t) => t.short);
}

export function setupInterviews(c: Career, ctx: Ctx): Career {
  const r = seededRng(`int-${c.seed}`);
  const order = draftOrder(ctx, c.seed);
  const N = order.length;
  const { lo, hi } = stockOf(c);
  const near: string[] = [];
  for (let o = Math.max(1, lo - 6); o <= Math.min(K.MAX_PICK, hi + 6) && near.length < N; o++) {
    const t = order[(o - 1) % N] as string;
    if (!near.includes(t)) near.push(t);
  }
  const rosterCache = new Map<string, Roster>();
  const rosterFor = (short: string) => {
    if (!rosterCache.has(short)) rosterCache.set(short, makeRoster(ctx, short, 0, []));
    return rosterCache.get(short) as Roster;
  };
  const wantOf = (t: string) => teamFit(ctx, t, c.pos, rosterFor(t), null, c.name).need;
  const teams = near
    .map((t) => ({ t, k: Math.pow(r(), 1 / Math.max(0.001, wantOf(t))) }))
    .sort((a, b) => b.k - a.k)
    .slice(0, 4)
    .map((x) => x.t);
  const qs = [...K.INTERVIEWS].sort(() => r() - 0.5).slice(0, teams.length);
  return {
    ...c,
    draft: {
      ...c.draft,
      interviews: qs.map((q, i) => ({ ...q, a: [...q.a].sort(() => r() - 0.5), team: teams[i] as string, answer: null })),
    },
  };
}

export function answerInterview(c: Career, index: number, choice: number): Career {
  const interviews = c.draft.interviews.map((x, k) => (k === index ? { ...x, answer: choice } : x));
  const done = interviews.every((x) => x.answer != null);
  const persona = done
    ? ['grinder', 'confident', 'cocky'].sort(
        (a, b) =>
          interviews.filter((x) => x.a[x.answer as number]?.persona === b).length -
          interviews.filter((x) => x.a[x.answer as number]?.persona === a).length,
      )[0] as string
    : c.draft.persona;
  return { ...c, draft: { ...c.draft, interviews, persona } };
}

export function runDraft(c: Career, ctx: Ctx): Career {
  const r = seededRng(`draft2-${c.seed}`);
  const order = draftOrder(ctx, c.seed);
  const N = order.length;
  const { lo, hi } = stockOf(c);
  const interest: Record<string, number> = {};
  for (const x of c.draft.interviews ?? []) if (x.answer != null) interest[x.team] = (interest[x.team] ?? 0) + (x.a[x.answer]?.stock ?? 0);
  const rosterCache = new Map<string, Roster>();
  const rosterFor = (short: string) => {
    if (!rosterCache.has(short)) rosterCache.set(short, makeRoster(ctx, short, 0, []));
    return rosterCache.get(short) as Roster;
  };
  const weigh = (team: string) => {
    const need = teamFit(ctx, team, c.pos, rosterFor(team), null, c.name).need;
    return { want: 1, w: need * need + 1 + Math.max(0, interest[team] ?? 0) * 8 };
  };
  const cands: { o: number; team: string; want: number; w: number }[] = [];
  for (let o = lo; o <= hi; o++) {
    const team = order[(o - 1) % N] as string;
    cands.push({ o, team, ...weigh(team) });
  }
  const total = cands.reduce((s, x) => s + x.w, 0);
  let roll = r() * total;
  let mine = cands[0] as { o: number; team: string; want: number; w: number };
  for (const x of cands) {
    roll -= x.w;
    if (roll <= 0) {
      mine = x;
      break;
    }
  }
  const ticker: TickerPick[] = [];
  const from = Math.max(1, mine.o - 6);
  const posList = ['G', 'F', 'C', 'G/F', 'F/C', 'PG', 'SG', 'SF', 'PF', 'C'];
  for (let o = from; o < mine.o; o++) {
    const team = order[(o - 1) % N] as string;
    ticker.push({ o, ...pickLabel(o), team, pos: posList[(o * 5) % posList.length] });
  }
  ticker.push({ o: mine.o, ...pickLabel(mine.o), team: mine.team, you: true });
  const roster = makeRoster(ctx, mine.team, 0, []);
  const fit = teamFit(ctx, mine.team, c.pos, roster, null, c.name);
  const contract = K.rookieDeal(mine.o);
  const met = (c.draft.interviews ?? []).some((x) => x.team === mine.team);
  const label = pickLabel(mine.o);
  return {
    ...c,
    phase: 'draft',
    step: 'day',
    draft: { ...c.draft, picks: ticker, pick: ticker[ticker.length - 1] as TickerPick },
    team: mine.team,
    roster,
    fit,
    contract,
    decisions: [
      ...c.decisions,
      { year: 1, text: `Drafted in round ${label.round}, pick ${label.slot} (No. ${mine.o} overall) by the ${fit.name}${met ? ' (they interviewed him)' : ''}` },
    ],
  };
}

// ── Injuries and swings ──────────────────────────────────────────────────────
export function injuryRisk(durability: number, age: number, sat: boolean): number {
  const perGame = K.INJ_RATE * clamp(1 + (5.5 - durability) * K.INJ_PULL, 0.3, 1.8);
  return perGame * (age >= 31 ? 1.25 : 1) * (sat ? 0 : 1) * K.INJ_SCALE;
}

export function injuryRoll(seed: string, year: number, k: number, total: number, durability: number, age: number, sat: boolean, recent: boolean): Injury | null {
  const r = seededRng(`${seed}-inj-${year}-${k}`);
  const risk = injuryRisk(durability, age, sat);
  if (k < total && r() < risk && !recent) {
    const weights = K.INJURIES.reduce((s, x) => s + (x[3] ?? 1), 0);
    let roll = r() * weights;
    let pick = K.INJURIES[0] as [string, number, number, number];
    for (const x of K.INJURIES) {
      roll -= x[3] ?? 1;
      if (roll <= 0) {
        pick = x;
        break;
      }
    }
    const [kind0, lo, hi] = pick;
    let games = lo + Math.floor(r() * (hi - lo + 1));
    const serious = r() < K.INJ_SERIOUS;
    const kind = serious ? (K.SEASON_ENDERS[Math.floor(r() * K.SEASON_ENDERS.length)] as string) : kind0;
    if (!serious) games = Math.min(games, total - k);
    return { kind, games: serious ? total - k : games, serious, at: k };
  }
  return null;
}

export interface SwingResult {
  dir: 0 | 1 | -1;
  streak: { on: boolean; hot: boolean; from: number; len: number };
}

export function seasonSwing(seed: string, year: number, age: number, contractLeft: number | null, total: number): SwingResult {
  const r = seededRng(`${seed}-swing-${year}`);
  const contractYear = contractLeft === 1;
  const up = 0.12 + (contractYear ? 0.06 : 0) + (age <= 24 ? 0.03 : 0);
  const down = 0.12 + (age >= 32 ? 0.06 : 0) - (contractYear ? 0.03 : 0);
  const roll = r();
  const dir: 0 | 1 | -1 = roll < up ? 1 : roll < up + down ? -1 : 0;
  let streak = { on: false, hot: false, from: 0, len: 8 };
  if (r() < 0.45) {
    const len = 8;
    const from = 2 + Math.floor(r() * Math.max(1, total - len - 3));
    const hot = r() < 0.55;
    streak = { on: true, hot, from, len };
  }
  return { dir, streak };
}

// ── Playoffs ─────────────────────────────────────────────────────────────────
export const closeChance = (p: number) => clamp(0.62 - Math.abs(p - 0.5) * 0.8, 0.35, 0.62);

export function bestOf7(g: number): number {
  return [1, 4, 10, 20].reduce((s, weight, k) => s + weight * g ** 4 * (1 - g) ** k, 0);
}

export function bucketRoundOdds(base: number, series: boolean): number {
  const g = clamp(0.5 + (base - 0.5) * 0.5, 0.22, 0.78);
  return Math.round((series ? bestOf7(g) : g) * 100) / 100;
}

export function gameOf(p: number, n = 7): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if ((n === 7 ? bestOf7(m) : m) > p) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
}

export function seriesState(seed: string, year: number, idx: number, p: number, n = 7): { a: number; b: number; g: number; need: number } {
  const need = (n + 1) / 2;
  const g = gameOf(p, n);
  const r = seededRng(`${seed}-${year}-${idx}-series`);
  let a = 0;
  for (let i = 0; i < need - 1; i++) if (r() < g) a++;
  return { a, b: need - 1 - a, g, need };
}

export function seriesPlay(seed: string, year: number, idx: number, p: number, hit: boolean, n = 7): { won: boolean; my: number; opp: number } {
  const { a, b, g, need } = seriesState(seed, year, idx, p, n);
  const r = seededRng(`${seed}-${year}-${idx}-series-rest`);
  let x = a;
  let y = b;
  if (hit) x++;
  else y++;
  while (x < need && y < need) {
    if (r() < g) x++;
    else y++;
  }
  return { won: x === need, my: x, opp: y };
}

export function buildBracket(c: Career, ctx: Ctx, final: FinalSeason): PlayoffState {
  const r = seededRng(`${c.seed}-po-${c.year}`);
  const mine = teamOf(ctx, c.team as string);
  const lg = (t: CareerTeam) => ({ ...t, off: t.off + (c.league?.[t.short]?.off ?? 0), def: t.def + (c.league?.[t.short]?.def ?? 0) });
  const pool = (conf: 'east' | 'west') =>
    ctx.teams
      .filter((t) => t.conf === conf && t.short !== c.team)
      .map(lg)
      .sort((a, b) => strength(b) + r() * 1.5 - (strength(a) + r() * 1.5));
  const confs: ('east' | 'west')[] = ['east', 'west'];
  const same = pool(mine.conf);
  const other = pool(confs.find((x) => x !== mine.conf) ?? mine.conf);
  const myStr = strength({ off: c.fit?.off ?? mine.off, def: c.fit?.def ?? mine.def });
  const seed = final.seed;
  const names = seed >= 7 ? [K.PLAY_IN, ...K.ROUNDS] : [...K.ROUNDS];
  const rounds = names.map((name, i) => {
    const fin = name === K.FINAL_ROUND;
    const playIn = name === K.PLAY_IN;
    const ri = playIn ? -1 : i - (seed >= 7 ? 1 : 0);
    const opp = fin
      ? (other[Math.floor(r() * 3)] as CareerTeam)
      : playIn
        ? (same[Math.min(same.length - 1, 6 + Math.floor(r() * 3))] as CareerTeam)
        : (same[Math.min(same.length - 1, Math.max(0, 3 - ri) * 2 + Math.floor(r() * 2))] as CareerTeam);
    const home = fin ? null : playIn ? seed <= 8 : ri === 0 ? seed <= 4 : seed <= 2;
    const base = 0.5 + (myStr - strength(opp)) * 0.08 + (home ? 0.06 : home === false ? -0.03 : 0) + ((c.ovr - 76) / 100) * 0.35 + Math.max(0, c.ovr - 95) * 0.018;
    const p = bucketRoundOdds(base, !playIn);
    r();
    return { name, opp: opp.short, oppName: opp.name, home, p, pw: bucketRoundOdds(base - 0.12, !playIn), played: false, series: !playIn } as Round;
  });
  return { idx: 0, rounds, line: [], stage: 'round', won: false, out: false };
}

export function watchBracket(c: Career, ctx: Ctx, po: PlayoffState): PlayoffState {
  void ctx;
  const r = seededRng(`${c.seed}-pow-${c.year}`);
  const line: Round[] = [];
  for (const rd of po.rounds) {
    const won = r() < (rd.pw ?? clamp(rd.p - 0.12, 0.08, 0.9));
    const other = [0, 1, 1, 2, 2, 3][Math.floor(r() * 6)] as number;
    const mySc = won ? 4 : other;
    const oppSc = won ? other : 4;
    line.push({ ...rd, played: true, won, mySc, oppSc });
    if (!won) break;
  }
  const last = line[line.length - 1];
  const won = !!last?.won && last.name === K.FINAL_ROUND;
  return { ...po, rounds: po.rounds.map((x, i) => line[i] ?? x), line, idx: line.length - 1, stage: 'done', won, out: !won };
}

export function momentHitRate(traitValue: number): number {
  return clamp(0.45 + (0.47 * (traitValue - 1)) / 10, 0.45, 0.92);
}

export function averageTrait(build: Traits, traits: string[]): number {
  const list = traits.filter((t) => build[t]);
  return list.length ? list.reduce((s, t) => s + (build[t]?.val ?? 5), 0) / list.length : 5;
}

// ── Aging, training, legacy ──────────────────────────────────────────────────
export const fadeOf = (pos: Position, t: string) => {
  const entry = K.FADE[pos]?.[t];
  return entry ? { cls: entry[0], from: entry[1], ...(K.FADE_CLASS[entry[0]] as K.FadeClass) } : null;
};
export const primeOf = (ch: Trait | undefined) => Math.min(11, Math.round(ch?.val ?? 0) + (ch?.faded ?? 0));
export const keepCap = (f: K.FadeClass & { from: number }, ch: Trait, age: number) => primeOf(ch) - Math.max(0, Math.floor((age - f.from) / f.keep));
export const bodyFade = (dur: number | null) => (dur == null ? 1 : clamp(1.25 - 0.05 * dur, 0.75, 1.2));

export function gradeUp(ch: Trait, to: number, trained = true): Trait {
  return (ch.faded ?? 0) > 0 ? { ...ch, val: to, faded: (ch.faded ?? 0) - 1 } : { ...ch, val: to, ...(trained ? { upgraded: (ch.upgraded ?? 0) + 1 } : {}) };
}

export function fadeYear(opts: {
  pos: Position;
  types: string[];
  build: Traits;
  seed: string;
  year: number;
  age: number;
  durability: number | null;
  declineAt: number;
}): { build: Traits; slipped: string[]; worked: string[]; spared: string[]; due: number } {
  const { pos, types, build, seed, year, age, declineAt } = opts;
  const out = { build: { ...build }, slipped: [] as string[], worked: [] as string[], spared: [] as string[], due: 0 };
  const gene = (0.85 + seededRng(`${seed}-agegene`)() * 0.35) * 1;
  const body = bodyFade(opts.durability);
  const late = age >= declineAt + 6;
  const cand: [string, number][] = [];
  for (const t of types) {
    const f = fadeOf(pos, t);
    const ch = build[t];
    if (!f || !ch || age < f.from) continue;
    out.due++;
    if (ch.workY === year) {
      out.worked.push(t);
      continue;
    }
    const step = (f.rate[Math.min(f.rate.length - 1, Math.floor((age - f.from) / f.step))] as number) * gene * (0.85 + seededRng(`${seed}-agegene-${t}`)() * 0.3) * (0.6 + seededRng(`${seed}-fade-${year}-${t}`)() * 0.8);
    const had = ch.wear ?? r10(seededRng(`${seed}-wear-${t}`)() * 0.7);
    const wear = had + step * body;
    out.build[t] = { ...ch, wear: r10(Math.min(1.6, wear)) };
    const room = Math.round(ch.val) - 1 >= Math.max(1, primeOf(ch) - f.floor);
    const rested = late || ch.slipY !== year - 1;
    if (wear >= 1 && room && rested) cand.push([t, wear]);
    else if (body < 1 && had + step >= 1 && wear < 1 && room && rested) out.spared.push(t);
  }
  cand.sort((a, b) => b[1] - a[1]);
  for (const [t] of cand.slice(0, age >= declineAt + 3 ? 3 : 2)) {
    const ch = out.build[t] as Trait;
    out.build[t] = { ...ch, val: Math.round(ch.val) - 1, faded: (ch.faded ?? 0) + 1, wear: r10((ch.wear ?? 0) - 1), slipY: year };
    out.slipped.push(t);
  }
  return out;
}

export function trainWindow(pos: Position, age: number, type: string): { tier: 'phys' | 'tech' | 'mind'; open: boolean; late: boolean; until: number } | null {
  const L = K.LADDER[pos];
  const physical = K.PHYSICAL[pos];
  const tier = physical.includes(type) || L.phys.includes(type) ? 'phys' : L.tech.includes(type) ? 'tech' : 'mind';
  if (tier === 'mind') return null;
  const [full, until] = tier === 'tech' ? L.techAt : [K.TRAIN_UNTIL, K.TRAIN_UNTIL + 1];
  return { tier, open: age <= until, late: age > full && age <= until, until };
}

export function upgradeCost(value: number, late: boolean): number {
  return (Math.round(value) >= 10 ? 2 : 1) * (late ? 2 : 1);
}

export function maxedTrait(value: number, ch: Trait | null, type: string | null): boolean {
  return Math.round(value) >= 11 || (type != null && K.UPGRADE_CAP[type] != null && (ch?.upgraded ?? 0) >= (K.UPGRADE_CAP[type] as number));
}

export function countedHonors(n: number): number {
  return Math.min(n, K.HONOR_KNEE) + Math.max(0, n - K.HONOR_KNEE) / 2;
}

export function legacyScore(c: Career, totals: { seasons: number; proBowls: number; allPros: number; awards: number; rings: number; playoffs: number; records: number; stats: Record<string, number> }, bonus: number): number {
  const honor = countedHonors(totals.proBowls);
  const parts = {
    seasons: totals.seasons,
    honors: honor,
    firsts: totals.allPros,
    rings: totals.rings,
    playoffs: totals.playoffs,
    records: totals.records,
  };
  const base = Object.entries(K.LEGACY_W).reduce((sum, [key, weight]) => (key === 'awards' ? sum : sum + ((parts as Record<string, number>)[key] ?? 0) * weight), 0);
  const awards = totals.awards * K.LEGACY_W.awards + Math.max(0, totals.awards - 1) * K.AWARD_REPEAT;
  void c;
  return Math.round(base + awards + K.legacyProd(totals.stats) + bonus);
}

export function hofVote(seed: string, score: number): { in: boolean; pct: number; ballot: string } {
  const r = seededRng(`${seed}-hof`);
  const pct = clamp(Math.round(20 + (score - 100) * 0.55 + (r() - 0.5) * 8), 2, 99);
  const inn = pct >= K.HOF_BAR;
  return { in: inn, pct, ballot: inn ? (pct >= 93 ? 'First ballot' : pct >= 86 ? 'Second ballot' : 'Inducted in year 4') : score >= 140 ? 'Finalist, not inducted' : 'Not on the ballot' };
}

export function legacyTier(score: number): string {
  return [...K.LEGACY_TIERS].reverse().find(([min]) => score >= min)?.[1] ?? 'Starter';
}
