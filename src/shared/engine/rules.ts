export const GUARD_ATTRS = [
  'jumpShot',
  'finishing',
  'passing',
  'handles',
  'perimeterDefense',
  'speed',
  'bounce',
  'size',
  'basketballIQ',
  'clutch',
] as const;

export const BIG_ATTRS = [
  'jumpShot',
  'finishing',
  'rebounding',
  'playmaking',
  'interiorDefense',
  'speed',
  'bounce',
  'size',
  'basketballIQ',
  'clutch',
] as const;

export const ATTR_LABELS: Record<string, { label: string; short: string }> = {
  jumpShot: { label: 'Jump Shot', short: 'JMP' },
  finishing: { label: 'Finishing', short: 'FIN' },
  passing: { label: 'Passing', short: 'PAS' },
  handles: { label: 'Handles', short: 'HND' },
  perimeterDefense: { label: 'Perimeter D', short: 'PER' },
  speed: { label: 'Speed', short: 'SPD' },
  bounce: { label: 'Bounce', short: 'BNC' },
  size: { label: 'Size', short: 'SZE' },
  basketballIQ: { label: 'Basketball IQ', short: 'IQ' },
  clutch: { label: 'Clutch', short: 'LDR' },
  rebounding: { label: 'Rebounding', short: 'REB' },
  playmaking: { label: 'Playmaking', short: 'PMK' },
  interiorDefense: { label: 'Interior D', short: 'INT' },
};

export const GRADES = ['F', 'D', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S'];

export function gradeFor(value: number): string {
  return GRADES[Math.max(0, Math.min(11, Math.round(value)))] ?? 'F';
}

export const OVR_WEIGHTS: Record<'guard' | 'big', Record<string, number>> = {
  guard: {
    jumpShot: 0.14,
    speed: 0.14,
    size: 0.14,
    finishing: 0.14,
    basketballIQ: 0.14,
    passing: 0.08,
    handles: 0.08,
    perimeterDefense: 0.08,
    bounce: 0.03,
    clutch: 0.03,
  },
  big: {
    finishing: 0.15,
    size: 0.15,
    interiorDefense: 0.15,
    rebounding: 0.15,
    jumpShot: 0.09,
    bounce: 0.07,
    playmaking: 0.07,
    basketballIQ: 0.07,
    speed: 0.07,
    clutch: 0.03,
  },
};

export const CURRENT_TEAMS: Record<string, { off: number; def: number }> = {
  ATL: { off: 78, def: 70 },
  BOS: { off: 79, def: 76 },
  BKN: { off: 61, def: 61 },
  CHA: { off: 74, def: 72 },
  CHI: { off: 67, def: 66 },
  CLE: { off: 73, def: 82 },
  DET: { off: 81, def: 82 },
  IND: { off: 62, def: 59 },
  MIA: { off: 71, def: 74 },
  MIL: { off: 66, def: 64 },
  NYK: { off: 80, def: 83 },
  ORL: { off: 70, def: 77 },
  PHI: { off: 75, def: 72 },
  TOR: { off: 75, def: 73 },
  WAS: { off: 63, def: 62 },
  DAL: { off: 70, def: 64 },
  DEN: { off: 80, def: 77 },
  GSW: { off: 70, def: 69 },
  HOU: { off: 78, def: 77 },
  LAC: { off: 72, def: 72 },
  LAL: { off: 77, def: 75 },
  MEM: { off: 64, def: 63 },
  MIN: { off: 76, def: 79 },
  NOP: { off: 65, def: 63 },
  OKC: { off: 85, def: 82 },
  PHX: { off: 76, def: 71 },
  POR: { off: 73, def: 71 },
  SAC: { off: 63, def: 61 },
  SAS: { off: 83, def: 82 },
  UTA: { off: 62, def: 62 },
};

export const ALLTIME_TEAMS: Record<string, { off: number; def: number }> = {
  ATL: { off: 82, def: 78 },
  BOS: { off: 88, def: 94 },
  BKN: { off: 83, def: 78 },
  CHA: { off: 79, def: 75 },
  CHI: { off: 90, def: 93 },
  CLE: { off: 84, def: 82 },
  DET: { off: 82, def: 90 },
  IND: { off: 83, def: 85 },
  MIA: { off: 87, def: 87 },
  MIL: { off: 85, def: 83 },
  NYK: { off: 83, def: 88 },
  ORL: { off: 82, def: 82 },
  PHI: { off: 88, def: 86 },
  TOR: { off: 82, def: 83 },
  WAS: { off: 80, def: 82 },
  DAL: { off: 85, def: 82 },
  DEN: { off: 84, def: 80 },
  GSW: { off: 95, def: 87 },
  HOU: { off: 87, def: 86 },
  LAC: { off: 82, def: 80 },
  LAL: { off: 93, def: 88 },
  MEM: { off: 79, def: 83 },
  MIN: { off: 83, def: 80 },
  NOP: { off: 80, def: 79 },
  OKC: { off: 87, def: 83 },
  PHX: { off: 90, def: 76 },
  POR: { off: 84, def: 82 },
  SAC: { off: 82, def: 76 },
  SAS: { off: 86, def: 94 },
  UTA: { off: 88, def: 83 },
};

export const EAST = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DET', 'IND', 'MIA', 'MIL', 'NYK', 'ORL', 'PHI', 'TOR', 'WAS',
];

export const WEST = [
  'DAL', 'DEN', 'GSW', 'HOU', 'LAC', 'LAL', 'MEM', 'MIN', 'NOP', 'OKC', 'PHX', 'POR', 'SAC', 'SAS', 'UTA',
];

export const EAST_SET = new Set(EAST);

export const CURRENT_FINALS_OPPS = {
  east: ['DET', 'BOS', 'NYK', 'CLE', 'TOR', 'ATL'],
  west: ['OKC', 'SAS', 'DEN', 'LAL', 'HOU', 'MIN'],
};

export const ALLTIME_FINALS_OPPS = {
  east: ['BOS', 'CHI', 'MIA', 'PHI', 'DET', 'NYK'],
  west: ['LAL', 'GSW', 'SAS', 'HOU', 'UTA', 'OKC'],
};

export const PER_LEAGUE = {
  mp: 241.3,
  fg: 42,
  fga: 89.1,
  tp: 13.3,
  ft: 18.4,
  fta: 23.5,
  orb: 11.4,
  trb: 43.8,
  ast: 26.7,
  stl: 8.4,
  blk: 4.8,
  tov: 14.5,
  pf: 19.9,
  pts: 115.6,
};

export const MVP_BENCHMARKS_CURRENT = [
  [31, 4, 5, 3, 4, 2],
  [26, 4, 8, 3, 11, 3],
  [29, 4, 8, 3, 8, 2],
  [23, 5, 3, 2, 10, 3],
  [27, 4, 5, 3, 11, 2],
];

export const MVP_BENCHMARKS_ALLTIME = [
  [30, 5, 5, 3, 6, 2],
  [26, 4, 7, 3, 7, 2],
  [19, 4, 11, 3, 7, 2],
  [23, 5, 6, 2, 9, 3],
  [25, 4, 3, 2, 13, 3],
];

export const DISPLAY_MVP_CURRENT = [
  { name: 'Nikola Jokic', short: 'Jokic', team: 'DEN', ppg: [26, 30], rpg: [11, 14], apg: [9, 12] },
  { name: 'Shai Gilgeous-Alexander', short: 'SGA', team: 'OKC', ppg: [29, 33], rpg: [4, 6], apg: [5, 7] },
  { name: 'Giannis Antetokounmpo', short: 'Giannis', team: 'MIA', ppg: [28, 32], rpg: [10, 13], apg: [5, 7] },
  { name: 'Luka Doncic', short: 'Luka', team: 'LAL', ppg: [26, 30], rpg: [8, 10], apg: [8, 11] },
  { name: 'Victor Wembanyama', short: 'Wemby', team: 'SAS', ppg: [24, 28], rpg: [9, 12], apg: [3, 5] },
];

export const DISPLAY_MVP_ALLTIME = [
  { name: 'Michael Jordan', short: 'Jordan', team: 'CHI', ppg: [31, 35], rpg: [5, 6], apg: [5, 6] },
  { name: 'LeBron James', short: 'LeBron', team: 'MIA', ppg: [27, 30], rpg: [7, 9], apg: [7, 9] },
  { name: 'Wilt Chamberlain', short: 'Wilt', team: 'PHI', ppg: [38, 50], rpg: [22, 27], apg: [2, 4] },
  { name: 'Kareem Abdul-Jabbar', short: 'Kareem', team: 'LAL', ppg: [28, 35], rpg: [13, 17], apg: [3, 5] },
  { name: 'Magic Johnson', short: 'Magic', team: 'LAL', ppg: [20, 23], rpg: [6, 8], apg: [10, 13] },
  { name: 'Larry Bird', short: 'Bird', team: 'BOS', ppg: [27, 30], rpg: [9, 11], apg: [6, 7] },
  { name: 'Oscar Robertson', short: 'Oscar', team: 'MIL', ppg: [28, 31], rpg: [10, 13], apg: [10, 12] },
  { name: "Shaquille O'Neal", short: 'Shaq', team: 'LAL', ppg: [27, 30], rpg: [12, 14], apg: [3, 4] },
  { name: 'Hakeem Olajuwon', short: 'Hakeem', team: 'HOU', ppg: [24, 27], rpg: [12, 14], apg: [3, 4] },
  { name: 'Moses Malone', short: 'Moses', team: 'HOU', ppg: [27, 31], rpg: [13, 15], apg: [1, 2] },
];

export const DISPLAY_DPOY_ALLTIME = [
  { name: 'Hakeem Olajuwon', short: 'Hakeem', team: 'HOU', spg: [1.6, 2], bpg: [3.7, 4.2] },
  { name: 'Bill Russell', short: 'Russell', team: 'BOS', spg: [1.8, 2.2], bpg: [4.5, 5.5] },
  { name: 'David Robinson', short: 'Robinson', team: 'SAS', spg: [1.7, 1.9], bpg: [3.8, 4.5] },
  { name: 'Dikembe Mutombo', short: 'Mutombo', team: 'DEN', spg: [0.5, 0.7], bpg: [3, 3.5] },
  { name: 'Gary Payton', short: 'Payton', team: 'SEA', spg: [1.8, 2.3], bpg: [0.2, 0.4] },
  { name: 'Ben Wallace', short: 'Wallace', team: 'DET', spg: [1.2, 1.6], bpg: [3, 3.7] },
];

export const DISPLAY_DPOY_CURRENT = {
  name: 'Victor Wembanyama',
  short: 'Wembanyama',
  team: 'SAS',
  spg: [1.2, 1.6],
  bpg: [3.2, 3.8],
};

export const DATA_SHA = '92cb2a155bb2261cd68038ac366b994ad5dbb873';
export const DATA_BASE = `https://cdn.jsdelivr.net/gh/GrahamEves-1210/build-a-player@${DATA_SHA}`;
export const HEADSHOT_BASE = `${DATA_BASE}/public/headshots/nba`;
