export type Position = 'guard' | 'big';
export type Era = 'current' | 'alltime';

export interface Player {
  name: string;
  short: string;
  team: string;
  starter?: boolean;
  captain?: boolean;
  number?: number | string;
  height?: number;
  weight?: number;
  wingspan?: number;
  skin?: string;
  position?: string;
  years?: string;
  attrs: Record<string, number>;
}

export interface Team {
  short: string;
  name: string;
  color: string;
  color2: string;
}

export interface Pick {
  attr: string;
  val: number;
  playerName: string;
  playerShort: string;
  team: string;
  number?: number | string;
}

export interface Build {
  position: Position;
  era: Era;
  picks: Record<string, Pick>;
}

export interface StandingRow {
  short: string;
  wins: number;
  isUs?: boolean;
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
}

export interface PlayInRound {
  type: 'playin';
  advanced: boolean;
  newSeed: number | null;
  games: string[];
  opponent: StandingRow;
  label: string;
}

export interface SeriesRound {
  type: 'series';
  name: string;
  roundIndex: number;
  opponent: StandingRow & { seed?: number; isOtherConf?: boolean };
  won: boolean;
  wins: number;
  losses: number;
  games: string[];
}

export type PlayoffRound = PlayInRound | SeriesRound;

export interface AwardWinner {
  name: string;
  short: string;
  team?: string;
  ppg?: number;
  rpg?: number;
  apg?: number;
  spg?: number;
  bpg?: number;
  isPlayer?: boolean;
}

export interface SeasonResult {
  ovr: number;
  archetype: string;
  wins: number;
  losses: number;
  position: Position;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  tov: number;
  fgPct: number;
  threePct: number;
  ftPct: number;
  per: number;
  games: GameLine[];
  gameLog: string[];
  bestGame: GameLine | null;
  conference: 'east' | 'west';
  seed: number;
  madePlayoffs: boolean;
  standings: StandingRow[];
  playoffRounds: PlayoffRound[];
  champion: boolean;
  team: string;
  mvp: boolean;
  dpoy: boolean;
  finalsOpp: string | null;
  finalsSeries: string | null;
  displayMvp: AwardWinner;
  displayDpoy: AwardWinner;
  goatRank: number | null;
}
