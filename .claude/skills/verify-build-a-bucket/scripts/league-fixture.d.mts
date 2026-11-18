export type FixtureRun = {
  devLocal?: boolean;
  neon?: boolean;
  prod?: boolean;
  base?: string;
  supervisorPid?: number;
  postgresPid?: number;
  postmasterPidPath?: string;
  socket?: string;
  socketDir?: string;
  port?: number;
  database?: string;
  readFile?: (path: string, encoding: string) => string;
  pidAlive?: (pid: number) => boolean;
};

export type FixtureEntry = {
  id: string;
  mode: string;
  era: string;
  players: number;
  code: string;
  secret: string;
  participants: { id: string; seat: number; name: string; team: string; build: { kind: string }; summary: unknown }[];
};

export type FixtureTarget = { socketDir: string; port: number; database: string };
export type FixtureRunner = {
  query?: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  transaction: (queries: { text: string; params?: unknown[] }[]) => Promise<unknown[]>;
  close?: () => Promise<void>;
  target?: FixtureTarget;
};

export function hashSecret(secret: string): string;
export function defaultConnect(target: FixtureTarget): Promise<FixtureRunner>;
export function guardOwnedRun(args: { run: FixtureRun | null; base?: string; readFile?: (path: string, encoding: string) => string; pidAlive?: (pid: number) => boolean }): FixtureTarget;
export function applyLeagueFixture(args: {
  entry: FixtureEntry;
  run: FixtureRun | null;
  connect?: (target: FixtureTarget) => Promise<FixtureRunner> | FixtureRunner;
  secrets: string[];
}): Promise<{ lobbyId: string; code: string; participantIds: string[]; target: FixtureTarget }>;
