export type ProcessIdentity = { pid: number; startTime: string; command: string; pgid: number };
export type ProbeState = 'present' | 'absent' | 'unknown';

export function sameIdentity(a: ProcessIdentity | null, b: ProcessIdentity | null): boolean;
export function readProcessIdentity(pid: number): ProcessIdentity | null;
export function groupMembers(pgid: number): { ok: true; members: ProcessIdentity[] } | { ok: false; reason: string };
export function descendants(pid: number, controls?: { pgrep?: (pid: number) => string }): { ok: true; pids: number[] } | { ok: false; reason: string };
export function probePid(pid: number, controls?: { kill?: (pid: number, signal: number) => void }): ProbeState;
export function probePort(port: number, controls?: { lsof?: (port: number) => string }): ProbeState;
