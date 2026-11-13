import type { SpinRecord } from '../engine/spin.js';
import type { Era, Pick, Position } from '../engine/types.js';
import type { LeagueView } from './league.js';

export type LobbyPhase =
  | 'lobby'
  | 'draw'
  | 'building'
  | 'preview'
  | 'season'
  | 'awards'
  | 'playin'
  | 'playoffs'
  | 'recap'
  | 'rematch';

export type ParticipantStatus = 'joined' | 'building' | 'ready' | 'left';

export type LeagueMode = 'normal' | 'salary' | 'squad';

export const CAPACITY = 8;
export const AWAY_MS = 60_000;
export const HOST_IDLE_MS = 45_000;
export const ATTRS_PER_BUILD = 10;
export const EVENT_LIMIT = 30;
export const SALARY_CARDS = 5;
export const SQUAD_PLAYERS = 5;

export interface LobbySettings {
  era: Era;
  mode: LeagueMode;
}

export interface BuildDraft {
  position: Position;
  era: Era;
  picks: Record<string, Pick>;
  spinIndex: number;
  teamRespinUsed: boolean;
  playerRespinUsed: boolean;
  current: { team: string; playerName: string } | null;
  team: string | null;
  latest?: { attr: string; playerName: string } | null;
}

export interface SalaryCardPick {
  id: string;
  name: string;
  team: string;
  price: number;
  attrs: Record<string, number>;
  fullAttrs: Record<string, number>;
  posGroup: Position;
}

export interface NormalBuild {
  kind: 'normal';
  position: Position;
  era: Era;
  picks: Record<string, Pick>;
  spins?: SpinRecord[];
}

export interface SalaryBuild {
  kind: 'salary';
  position: Position;
  cards: SalaryCardPick[];
}

export interface SquadPlayerBuild {
  slot: string;
  position: Position;
  picks: Record<string, Pick>;
  spins?: SpinRecord[];
}

export interface SquadBuild {
  kind: 'squad';
  players: SquadPlayerBuild[];
}

export type LobbyBuild = NormalBuild | SalaryBuild | SquadBuild;

export interface BuildSummary {
  filled: number;
  total: number;
  latest: string | null;
  ovr: number;
  auto: boolean;
}

export interface SalaryPowersView {
  shuffle: boolean;
  scout: boolean;
  scouted: Record<string, string>;
}

export interface TeamAssignmentView {
  seat: number;
  name: string;
  team: string;
  rerollUsed: boolean;
  isMe: boolean;
}

export interface ParticipantSeasonView {
  wins: number;
  losses: number;
  seed: number | null;
  finish: string | null;
  champion: boolean;
}

export interface ParticipantView {
  seat: number;
  name: string;
  isHost: boolean;
  isMe: boolean;
  away: boolean;
  status: ParticipantStatus;
  joinedAt: string;
  lastSeen: string;
  team: string | null;
  rerollUsed: boolean;
  build: LobbyBuild | null;
  summary: BuildSummary | null;
  buildSeed: string | null;
  ready: boolean;
  season: ParticipantSeasonView | null;
}

export interface EventView {
  id: number;
  kind: string;
  seat: number | null;
  name: string | null;
  detail: string | null;
  at: string;
}

export interface ReadyView {
  ready: number;
  present: number;
  mine: boolean;
}

export interface LobbyView {
  code: string;
  phase: LobbyPhase;
  version: number;
  settings: LobbySettings;
  capacity: number;
  seatsTaken: number;
  hostSeat: number | null;
  stage: number;
  stageName: string;
  stageTotal: number;
  stageCursor: number;
  checkpoint: boolean;
  stageStartedAt: string | null;
  participants: ParticipantView[];
  me: ParticipantView;
  events: EventView[];
  teams: TeamAssignmentView[];
  salaryBoard: SalaryCardPick[][] | null;
  salaryBudget: number | null;
  salaryPowers: SalaryPowersView | null;
  league: LeagueView | null;
  ready: ReadyView;
  serverTime: string;
}

export interface ParticipantProgress {
  seat: number;
  status: ParticipantStatus;
  away: boolean;
  summary: BuildSummary | null;
  team: string | null;
  ready: boolean;
}

export interface LobbyDelta {
  version: number;
  serverTime: string;
  participants: ParticipantProgress[];
  events: EventView[];
}

export interface ApiErrorBody {
  error: string;
  reason: 'not_found' | 'full' | 'started' | 'forbidden' | 'conflict' | 'invalid' | 'server';
}
