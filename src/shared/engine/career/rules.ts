import type { Position } from '../types';

export const CAREER_V = 1;
export const FIRST_SEASON = 2026;
export const MAX_SEASONS = 20;
export const CAREER_SLOTS = 5;
export const HISTORY_LIMIT = 20;
export const DRAFT_ROUNDS = 2;
export const TEAMS_PER_LEAGUE = 30;
export const MAX_PICK = TEAMS_PER_LEAGUE * DRAFT_ROUNDS;
export const STEP = 10;
export const REGULAR_GAMES = 82;
export const GAMES_MODE = ['simple', 'off'] as const;
export type GamesMode = (typeof GAMES_MODE)[number];

export interface GroupRatings {
  off: number;
  def: number;
}

export const ROUNDS = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'] as const;
export const FINAL_ROUND = 'NBA Finals';
export const PLAY_IN = 'Play-In';
export const PLAYOFF_WIN_BAR = 40;
export const PLAYOFF_SEEDS = 10;

export const HONOR_KNEE = 8;
export const AWARD_REPEAT = 4;
export const LEGACY_W = { seasons: 2, honors: 6, firsts: 10, awards: 18, rings: 20, playoffs: 3, records: 8 };
export const LEGACY_TIERS: [number, string][] = [
  [0, 'Starter'],
  [80, 'Star'],
  [170, 'Superstar'],
  [280, 'All-Time Great'],
];
export const CAMP_LEGACY = 1;
export const SHOE = { deal: { legacy: 2, perYear: 2 }, signature: { legacy: 4, perYear: 6 } };
export const EARN_LEGACY = { per: 25, max: 5 };
export const HOF_LEGACY = 209;
export const HOF_BAR = 80;

export const INJ_RATE = 0.019;
export const INJ_PULL = 0.15;
export const INJ_SCALE = 26 / 82;
export const INJ_SERIOUS = 0.05;
export const BIG_INJURY = 20;
export const AGE_DECLINE = 31;
export const TRAIN_UNTIL = 25;
export const DEV_YOUNG = 20;
export const DEV_PRIME = 25;
export const BODY_MAX = 10;

export const MONEY: Record<Position, [number, number]> = { guard: [2, 55], big: [2, 52] };
export const RETIRE_AGE = 38;
export const UPGRADE_CAP: Record<string, number> = { size: 2, speed: 3, bounce: 3 };
export const PHYSICAL: Record<Position, string[]> = { guard: ['speed', 'bounce'], big: ['bounce', 'speed'] };

export const LADDER: Record<Position, { phys: string[]; tech: string[]; techAt: [number, number] }> = {
  guard: { phys: ['size'], tech: ['finishing', 'handles', 'perimeterDefense'], techAt: [31, 33] },
  big: { phys: ['size'], tech: ['finishing', 'rebounding', 'interiorDefense'], techAt: [31, 33] },
};

export const FADE: Record<Position, Record<string, [string, number]>> = {
  guard: {
    bounce: ['quick', 29],
    speed: ['quick', 30],
    perimeterDefense: ['skill', 31],
    finishing: ['skill', 32],
    handles: ['skill', 34],
  },
  big: {
    bounce: ['quick', 29],
    speed: ['quick', 30],
    interiorDefense: ['skill', 31],
    finishing: ['skill', 32],
    rebounding: ['skill', 33],
  },
};

export interface FadeClass {
  rate: number[];
  step: number;
  keep: number;
  floor: number;
}

export const FADE_CLASS: Record<string, FadeClass> = {
  quick: { rate: [0.6, 0.9, 1.1, 1.2], step: 2, keep: 2, floor: 5 },
  power: { rate: [0.45, 0.75, 1.0, 1.1], step: 2, keep: 3, floor: 4 },
  skill: { rate: [0.3, 0.6, 0.9, 1.0], step: 2, keep: 3, floor: 4 },
};

export const INJURIES: [string, number, number, number][] = [
  ['ankle sprain', 2, 10, 6],
  ['knee soreness', 2, 6, 4],
  ['hamstring strain', 5, 15, 3],
  ['concussion', 1, 5, 2],
  ['back spasms', 2, 6, 3],
  ['wrist sprain', 3, 10, 2],
  ['calf strain', 6, 16, 2],
  ['plantar fasciitis', 4, 14, 1.5],
  ['MCL sprain', 8, 20, 1],
  ['fractured hand', 12, 25, 0.8],
];
export const SEASON_ENDERS = ['torn ACL', 'ruptured Achilles', 'torn meniscus'];

const STOCK_STEPS: [number, [number, number]][] = [
  [95, [1, 3]],
  [90, [1, 5]],
  [86, [5, 15]],
  [82, [10, 25]],
  [78, [18, 35]],
  [74, [28, 48]],
  [70, [40, 58]],
  [0, [48, 60]],
];

export function stockRange(ovr: number): [number, number] {
  for (const [floor, range] of STOCK_STEPS) if (ovr >= floor) return range;
  return [48, 60];
}

export interface Contract {
  kind: 'rookie' | 'fa' | 'ext';
  years: number;
  left: number;
  perYear: number;
  option: boolean;
  noTrade?: boolean;
  starter?: boolean;
}

export function rookieDeal(pick: number): Contract {
  const years = pick <= 30 ? 4 : 2;
  const perYear = pick <= 1 ? 12.5 : pick <= 5 ? 9.5 : pick <= 10 ? 6.5 : pick <= 14 ? 5 : pick <= 30 ? 2.8 : 1.9;
  return { kind: 'rookie', years, left: years, perYear, option: pick <= 30 };
}

interface DashRow {
  [key: string]: number[];
}

const DASH_SPRINT: DashRow = { guard: [3.6, 3.25, 3.02], big: [3.8, 3.42, 3.18] };
const BENCH_N: DashRow = { guard: [2, 10, 18], big: [5, 16, 26] };

function line(row: number[], v: number): number {
  const [f, b, s] = row as [number, number, number];
  return v <= 6 ? f + ((b - f) * (Math.max(v, 1) - 1)) / 5 : b + ((s - b) * (Math.min(v, 11) - 6)) / 5;
}

export function dashTarget(game: 'sprint' | 'forty', pos: string, v: number): number {
  const row = DASH_SPRINT[pos] ?? DASH_SPRINT[game === 'sprint' ? 'guard' : 'wr'] ?? DASH_SPRINT.guard;
  return line(row as number[], v);
}

export function dashTypical(game: 'sprint' | 'forty', pos: string): number {
  return dashTarget(game, pos, 6) + 0.05;
}

function benchCeil(pos: string, v: number): number {
  const row = BENCH_N[pos] ?? BENCH_N.guard;
  return line(row as number[], v);
}

export function benchTypical(pos: string): number {
  return benchCeil(pos, 6) * 0.68;
}

export type DrillId = 'sprint' | 'lane' | 'spot' | 'vert' | 'nbench';

export interface DrillSpec {
  id: DrillId;
  label: string;
  trait: string;
}

export const COMBINE: Record<Position, DrillSpec[]> = {
  guard: [
    { id: 'sprint', label: '3/4-court sprint', trait: 'speed' },
    { id: 'lane', label: 'Lane agility', trait: 'perimeterDefense' },
    { id: 'spot', label: 'Spot-up shooting', trait: 'jumpShot' },
  ],
  big: [
    { id: 'vert', label: 'Max vertical', trait: 'bounce' },
    { id: 'nbench', label: 'Bench press', trait: 'size' },
    { id: 'spot', label: 'Spot-up shooting', trait: 'jumpShot' },
  ],
};

export const MIN_GAMES = { award: 65 / 82, first: 65 / 82, honor: 40 / 82 };

export const GOALS: Record<Position, (ovr: number) => [string, string, number, string][]> = {
  guard: (ovr) => [
    ['ppg', 'Average', ovr >= 90 ? 26 : ovr >= 82 ? 21 : 16, 'points'],
    ['apg', 'Average', ovr >= 90 ? 8 : ovr >= 82 ? 6 : 4, 'assists'],
    ['wins', 'Win', ovr >= 90 ? 55 : ovr >= 82 ? 48 : 40, 'games'],
  ],
  big: (ovr) => [
    ['ppg', 'Average', ovr >= 90 ? 25 : ovr >= 82 ? 20 : 15, 'points'],
    ['rpg', 'Average', ovr >= 90 ? 12 : ovr >= 82 ? 10 : 9, 'rebounds'],
    ['wins', 'Win', ovr >= 90 ? 55 : ovr >= 82 ? 48 : 40, 'games'],
  ],
};

export function proBowlFor(pos: Position, s: { ppg: number; apg: number; rpg: number }): boolean {
  return pos === 'guard' ? s.ppg >= 21 || (s.ppg >= 17 && s.apg >= 7) : s.ppg >= 20 || (s.ppg >= 16 && s.rpg >= 10);
}

export function allProFor(pos: Position, s: { ppg: number; apg: number; rpg: number }): boolean {
  return pos === 'guard' ? s.ppg >= 25 || (s.ppg >= 22 && s.apg >= 8) : s.ppg >= 24 || (s.ppg >= 20 && s.rpg >= 11);
}

export function allProNear(pos: Position, s: { ppg: number }): boolean {
  return pos === 'guard' ? s.ppg >= 22 : s.ppg >= 20;
}

export function seasonScore(pos: Position, s: { ppg: number; apg: number; rpg: number; wins: number; award?: boolean; champion?: boolean }): number {
  const base =
    pos === 'guard'
      ? (s.ppg / 30) * 0.45 + (s.apg / 10) * 0.25 + (s.wins / 60) * 0.3
      : (s.ppg / 28) * 0.45 + (s.rpg / 13) * 0.25 + (s.wins / 60) * 0.3;
  return Math.max(0, Math.min(1.2, base + (s.award ? 0.15 : 0) + (s.champion ? 0.1 : 0)));
}

export function legacyProd(st: { pts?: number; reb?: number; ast?: number }): number {
  return (st.pts ?? 0) / 600 + ((st.reb ?? 0) + (st.ast ?? 0)) / 700;
}

export interface InterviewQuestion {
  who: string;
  q: string;
  a: { t: string; stock: number; persona: string }[];
}

export const INTERVIEWS: InterviewQuestion[] = [
  {
    who: 'General manager',
    q: 'We have an All-Star at the position. A year off the bench: is that a problem?',
    a: [
      { t: 'Whatever the team needs. I\u2019ll earn the minutes.', stock: 1, persona: 'grinder' },
      { t: 'I\u2019ll compete for the job from the first practice.', stock: 2, persona: 'confident' },
      { t: 'I didn\u2019t come here to sit.', stock: -1, persona: 'cocky' },
    ],
  },
  {
    who: 'Head coach',
    q: 'We won twenty games last year. Why come here?',
    a: [
      { t: 'Somebody has to turn it around. I want to be the reason.', stock: 2, persona: 'grinder' },
      { t: 'You\u2019re a piece or two away. I\u2019m one of them.', stock: 1, persona: 'confident' },
      { t: 'Honestly, I\u2019d rather go to a winner.', stock: -2, persona: 'cocky' },
    ],
  },
  {
    who: 'Assistant coach',
    q: 'On this clip the help defender steps up on the drive. What\u2019s the read?',
    a: [
      { t: 'The corner is open. Kick it out before the rotation gets there.', stock: 2, persona: 'confident' },
      { t: 'Hit the roll man. He\u2019s got the lane.', stock: 1, persona: 'grinder' },
      { t: 'Finish through it. I don\u2019t pass out of that.', stock: -1, persona: 'cocky' },
    ],
  },
  {
    who: 'Owner',
    q: 'The first real contract. Where does that money go?',
    a: [
      { t: 'Take care of my family. Then get back in the gym.', stock: 1, persona: 'grinder' },
      { t: 'Nothing changes. The next one\u2019s bigger.', stock: 1, persona: 'confident' },
      { t: 'Cars. I\u2019m not going to lie to you.', stock: -1, persona: 'cocky' },
    ],
  },
  {
    who: 'General manager',
    q: 'Our doctors flagged an old knee issue. Be straight with us.',
    a: [
      { t: 'Fully healed. Here are my rehab notes, read them.', stock: 2, persona: 'grinder' },
      { t: 'Never missed a game because of it.', stock: 1, persona: 'confident' },
      { t: 'Doctors worry too much.', stock: -2, persona: 'cocky' },
    ],
  },
  {
    who: 'Head coach',
    q: 'The last time a coach pulled the plug mid-game. Tell me about it.',
    a: [
      { t: 'Sophomore year, four turnovers in a half. I fixed it, and I earned it back.', stock: 2, persona: 'grinder' },
      { t: 'I haven\u2019t been pulled since high school.', stock: 0, persona: 'confident' },
      { t: 'It was the coach\u2019s fault, honestly.', stock: -2, persona: 'cocky' },
    ],
  },
  {
    who: 'Player development coach',
    q: 'We switch everything on defense. One through five, every night. Ready for that?',
    a: [
      { t: 'I\u2019ll guard whoever you put in front of me. Show me the film.', stock: 2, persona: 'grinder' },
      { t: 'I\u2019ll lock up anyone.', stock: 1, persona: 'confident' },
      { t: 'Defense is for the guys who can\u2019t score.', stock: -2, persona: 'cocky' },
    ],
  },
  {
    who: 'General manager',
    q: 'A teammate calls out the new guy on a podcast. What happens next?',
    a: [
      { t: 'Talk to him face to face. Keep it in the building.', stock: 2, persona: 'grinder' },
      { t: 'Let my game answer it on the floor.', stock: 1, persona: 'confident' },
      { t: 'Fire back online. People should know.', stock: -2, persona: 'cocky' },
    ],
  },
  {
    who: 'Head coach',
    q: 'Who\u2019s the best player in this draft?',
    a: [
      { t: 'There are a lot of good ones. I\u2019ll let you decide.', stock: 1, persona: 'grinder' },
      { t: 'You\u2019re looking at him.', stock: 1, persona: 'confident' },
      { t: 'Not even close. Me, then everyone else.', stock: -1, persona: 'cocky' },
    ],
  },
];

export interface OffseasonEvent {
  id: string;
  w: number;
  good?: boolean;
  bad?: boolean;
  when?: (rep: number, age: number, rookieLeftOne: boolean, lastWins: number) => boolean;
  text: (team: string, name: string) => string;
  mods?: { off?: number; def?: number };
  rep?: number;
  durability?: number;
  durBase?: number;
  dev?: number;
}

export const EVENTS: OffseasonEvent[] = [
  { id: 'new-coach', w: 3, text: (t) => `The ${t} hire a new head coach. New sets, new rotations to learn.`, mods: { off: -0.5 } },
  { id: 'star-trade', w: 2, text: (t) => `The ${t} trade for an All-Star. The floor just opened up.`, mods: { off: 1 } },
  { id: 'coach-fired', w: 2, when: (_rep, _age, _rookie, wins) => wins <= 30, text: (t) => `The ${t} fire the head coach after a lost season. A reset is coming.`, mods: { off: -0.5, def: -0.5 } },
  { id: 'defense-up', w: 2, text: (t) => `The ${t} bring in two defenders and a rim protector. Grind-it-out wins are coming.`, mods: { def: 1 } },
  { id: 'trainer', w: 2, text: () => 'A new performance staff and a full summer in the gym. The body feels bulletproof.', durability: 0.6, durBase: 0.3 },
  { id: 'extension', w: 1, when: (rep, _age, rookieLeftOne) => rookieLeftOne && rep >= 6, text: () => 'The agent wants the extension done now. Talks stall into training camp.', mods: { off: -0.5 }, rep: -1 },
  { id: 'captain', w: 2, when: (rep) => rep >= 7, text: (t) => `The ${t} name him a captain. The locker room is his.`, rep: 1 },
  { id: 'system', w: 2, text: (t) => `The ${t} rebuild the offense around their best players. More touches are coming.`, mods: { off: 0.5 } },
  { id: 'mentor', w: 2, good: true, when: (_rep, age) => age <= 25, text: (t, name) => `A fifteen-year veteran on the ${t} takes ${name} under his wing. Film every morning, extra shots every night.`, dev: 1 },
  { id: 'built-around', w: 2, good: true, when: (rep) => rep >= 6, text: (t, name) => `The ${t} put the ball in ${name}'s hands. More sets, more touches.`, mods: { off: 0.75 } },
  { id: 'rift', w: 2, bad: true, when: (rep) => rep <= 4, text: (t) => `The ${t} locker room hasn\u2019t gotten over last year. Nobody\u2019s passing to anybody.`, mods: { off: -0.5, def: -0.5 }, rep: -1 },
  { id: 'camp-tweak', w: 2, bad: true, text: () => 'A sprained ankle in a summer run. Nothing serious, but it lingers into the season.', durability: -0.4 },
  { id: 'shooters-gone', w: 2, text: (t) => `The ${t} lose two shooters in free agency. The floor gets smaller.`, mods: { off: -0.75 } },
  { id: 'quiet', w: 3, text: () => 'A quiet summer at the facility. Camp opens, and the grind begins.' },
];
export const STAY_EVENTS = new Set(['coach-fired', 'captain', 'rift']);
