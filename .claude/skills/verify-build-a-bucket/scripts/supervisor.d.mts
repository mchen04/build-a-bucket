export type Service = {
  name: string;
  kind: 'app' | 'postgres';
  port?: number;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdio?: unknown;
  logPath?: string;
  detached?: boolean;
};
export type ServiceResult = { name: string; pid: number; state: 'clean' | 'uncertain'; reason: string | null };
export type Clock = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  clearTimeout: (handle: unknown) => void;
};
export type Controls = {
  readIdentity: (pid: number) => unknown;
  groupMembers: (pgid: number) => { ok: true; members: { pid: number }[] } | { ok: false; reason: string };
  descendants: (pid: number) => { ok: true; pids: number[] } | { ok: false; reason: string };
  probe: (pid: number) => 'present' | 'absent' | 'unknown';
  probePort: (port: number) => 'present' | 'absent' | 'unknown';
  clock: Clock;
};

export function waitForExit(child: unknown, timeoutMs: number, clock: Clock): Promise<{ code: number | null; signal: string | null } | null>;
export function stopService(options: { service: Service; child: unknown; controls: Controls }): Promise<ServiceResult>;
export function startSupervisor(options: {
  runDir: string;
  services: Service[];
  controlPath: string;
  receiptPath: string;
  ackPath: string;
  spawn?: unknown;
  clock?: Clock;
  controls: Controls;
  handoffMs?: number;
  exit?: (code: number) => void;
}): Promise<{ children: unknown[]; stop: () => Promise<ServiceResult[]> }>;
export function requestStop(options: { controlPath: string; receiptPath: string; timeoutMs?: number; clock?: Clock }): Promise<{ ok: boolean; services: ServiceResult[]; reason?: string }>;
export function runSupervised(options: {
  services?: Service[];
  children?: { service: Service; child: unknown }[] | null;
  command: string[];
  commandEnv?: Record<string, string>;
  commandCwd?: string;
  controls: Controls & { spawn: unknown };
  receiptPath?: string;
}): Promise<{ code: number; results: ServiceResult[] }>;
