export type ProcessIdentity = { pid: number; startTime: string; command: string; pgid: number };
export type ProbeState = 'present' | 'absent' | 'unknown';
export type CleanupResult = {
  stopped: number[];
  uncertain: { pid: number; reason: string }[];
  failures: { pid: number; reason: string }[];
};

export function sameIdentity(a: ProcessIdentity | null, b: ProcessIdentity | null): boolean;
export function readProcessIdentity(pid: number): ProcessIdentity | null;
export function probePid(pid: number, controls?: { kill?: (pid: number, signal: number) => void }): ProbeState;
export function probePort(port: number, controls?: { lsof?: (port: number) => string }): ProbeState;
export function cleanupOwned(options: {
  root: ProcessIdentity;
  descendants?: ProcessIdentity[];
  controls: {
    readIdentity: (pid: number) => ProcessIdentity | null;
    signal: (pid: number, signal: string) => void;
    sleep: (ms: number) => void;
    probe: (pid: number) => ProbeState;
  };
}): CleanupResult;
