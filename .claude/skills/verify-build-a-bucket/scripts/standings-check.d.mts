export type Revision = { stage: string; progress: string };
export type Seat = { seat: number; name: string };
export type Read = { seat: Seat; revision: unknown; tables: string[][] };
export type CompareResult = {
  ok: boolean;
  reason?: string;
  revision?: Revision;
  seats?: string[];
  standings?: string[][];
  rowsCompared?: number;
};
export type Coverage = { ok: boolean; reason: string | null };
export type ReloadRecord = {
  ran?: boolean;
  revision?: unknown;
  seats?: unknown;
  rowsCompared?: number;
  refreshedSeat?: unknown;
  coverage?: string;
  [key: string]: unknown;
};
export type FailureSummary = {
  ok: boolean;
  error: string;
  reload: ReloadRecord;
  failedAt: string;
  [key: string]: unknown;
};

export function isValidRevision(revision: unknown): boolean;
export function revisionKey(revision: unknown): string | null;
export function revisionLabel(revision: unknown): string;
export function readLeagueStandings(): { revision: Revision; tables: string[][] };
export function distinctSeatLabels(seats: unknown): Set<string>;
export function canonicalTables(tables: unknown): string[][];
export function compareStandings(reads: Read[], refreshedSeat: Seat): CompareResult;
export function createLeagueEvidenceDir(evidenceRoot: string, stamp?: string, suffix?: string): string;
export function refreshCoverage(reloadRequested: boolean, reload: unknown): Coverage;
export function reloadRecord(reloadRequested: boolean, reload: unknown): ReloadRecord;
export function leagueFailureSummary(args: Record<string, unknown>): FailureSummary;
export function assertRefreshCoverage(reloadRequested: boolean, reload: unknown): void;
