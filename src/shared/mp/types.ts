import type { Era, Pick, Position } from '../engine/types.js';

export type LobbyPhase = 'lobby' | 'building' | 'season' | 'barrier' | 'playoffs' | 'finished';

export type ParticipantStatus =
  | 'joined'
  | 'building'
  | 'built'
  | 'season_done'
  | 'qualified'
  | 'eliminated'
  | 'playoffs'
  | 'done'
  | 'left';

export const CAPACITY = 8;
export const AWAY_MS = 60_000;
export const HOST_IDLE_MS = 45_000;
export const DEFAULT_REVEAL_SECONDS = 5;
export const BARRIER_HOLD_SECONDS = 3;
export const MAX_ROUNDS = 5;
export const EVENT_LIMIT = 30;

export interface LobbySettings {
  era: Era;
  positions: Position[];
  revealSeconds: number;
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

export interface BuildSummary {
  filled: number;
  total: number;
  latest: string | null;
}

export interface SeasonSummary {
  wins: number;
  losses: number;
  ovr: number;
  seed: number;
  ppg: number;
  rpg: number;
  apg: number;
  madePlayoffs: boolean;
  champion: boolean;
  archetype: string;
  team: string;
  qualified: boolean;
  finishRank: number | null;
  finishLabel: string | null;
}

export interface RoundView {
  name: string;
  opponent: string;
  won: boolean;
  wins: number;
  losses: number;
  label: string | null;
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
  build: BuildDraft | null;
  summary: BuildSummary | null;
  season: SeasonSummary | null;
  rounds: RoundView[];
  roundsTotal: number;
}

export interface EventView {
  id: number;
  kind: string;
  seat: number | null;
  name: string | null;
  detail: string | null;
  at: string;
}

export interface StandingEntry {
  seat: number;
  name: string;
  isMe: boolean;
  record: string;
  ovr: number;
  finishLabel: string | null;
}

export interface LobbyView {
  code: string;
  phase: LobbyPhase;
  version: number;
  settings: LobbySettings;
  capacity: number;
  seatsTaken: number;
  hostSeat: number | null;
  playoffsStartedAt: string | null;
  revealSeconds: number;
  roundsRevealed: number;
  roundsTotal: number;
  participants: ParticipantView[];
  me: ParticipantView;
  events: EventView[];
  standings: StandingEntry[] | null;
  serverTime: string;
}

export interface ParticipantProgress {
  seat: number;
  status: ParticipantStatus;
  away: boolean;
  summary: BuildSummary | null;
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

export function finishRankOf(input: {
  champion: boolean;
  madePlayoffs: boolean;
  seriesRounds: number;
  playedPlayIn: boolean;
}): number {
  if (input.champion) return 1;
  if (input.seriesRounds >= 4) return 2;
  if (input.seriesRounds === 3) return 3;
  if (input.seriesRounds === 2) return 4;
  if (input.seriesRounds === 1) return 5;
  if (input.playedPlayIn || input.madePlayoffs) return 6;
  return 9;
}
