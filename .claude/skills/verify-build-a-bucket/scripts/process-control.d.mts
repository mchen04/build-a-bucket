export type ProcessIdentity = { pid: number; startTime: string; command: string; pgid: number };
export type ProbeState = 'present' | 'absent' | 'unknown';
export type CleanupResult = {
  stopped: number[];
  uncertain: { pid: number; reason: string }[];
  failures: { pid: number; reason: string }[];
};
export type PostgresResult = { state: 'clean' | 'uncertain'; reason: string | null; dataDir: string | null; removed: boolean };
export type CleanupControls = {
  readIdentity: (pid: number) => ProcessIdentity | null;
  signal: (pid: number, signal: string) => void;
  sleep: (ms: number) => void | Promise<void>;
  probe: (pid: number) => ProbeState;
  groupMembers: (pgid: number) => { ok: true; members: ProcessIdentity[] } | { ok: false; reason: string };
  probePort: (port: number) => ProbeState;
  removeDir: (dir: string) => void;
};

export function sameIdentity(a: ProcessIdentity | null, b: ProcessIdentity | null): boolean;
export function readProcessIdentity(pid: number): ProcessIdentity | null;
export function probePid(pid: number, controls?: { kill?: (pid: number, signal: number) => void }): ProbeState;
export function probePort(port: number, controls?: { lsof?: (port: number) => string }): ProbeState;
export function cleanupOwned(options: {
  root: ProcessIdentity;
  members?: { identity: ProcessIdentity; owned: boolean }[];
  controls: Pick<CleanupControls, 'readIdentity' | 'signal' | 'sleep' | 'probe'>;
}): Promise<CleanupResult>;
export function cleanupRun(options: {
  state: { pid: number; port: number; identity?: ProcessIdentity | null };
  controls: CleanupControls;
}): Promise<CleanupResult & { portState: ProbeState }>;
export function stopOwnedPostgres(options: {
  handle: { dataDir: string; pgPort: number; postmasterIdentity?: ProcessIdentity | null };
  controls: Pick<CleanupControls, 'readIdentity' | 'signal' | 'sleep' | 'probe' | 'probePort' | 'groupMembers'>;
}): Promise<PostgresResult>;
export function cleanupAll(options: {
  state: {
    pid: number;
    port: number;
    identity?: ProcessIdentity | null;
    localDb?: { dataDir: string; pgPort: number; postmasterIdentity?: ProcessIdentity | null; remove?: boolean } | null;
  };
  controls: CleanupControls;
}): Promise<CleanupResult & { portState: ProbeState; postgres: PostgresResult }>;
