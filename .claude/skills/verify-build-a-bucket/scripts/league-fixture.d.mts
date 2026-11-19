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
  expectedClass: 'qualifying' | 'all-eliminated';
  qualifyingSeats: number[];
  participants: { id: string; seat: number; name: string; team: string; build: { kind: string }; summary: unknown }[];
};

export type FixtureState = {
  mode?: string;
  localDb?: { database?: string; pgPort?: number } | null;
  supervisor?: { pid?: number } | null;
};
export type FixtureInit = { state?: string; database: string; dataDir: string; sockDir: string };
export type FixtureSupervisor = { pid: number; services?: { name: string; pid: number }[]; postgres?: { pid: number; port: number; database: string; dataDir: string; sockDir: string } | null };

export type FixtureTarget = { socketDir: string; port: number; database: string };
export type FixtureRunner = {
  query?: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  transaction: (queries: { text: string; params?: unknown[] }[]) => Promise<unknown[]>;
  close: () => Promise<void>;
  target?: FixtureTarget;
};

export function hashSecret(secret: string): string;
export function fixtureRunFrom(args: { state: FixtureState; init: FixtureInit; supervisor: FixtureSupervisor }): FixtureRun;
export function fixtureOptions(entry: FixtureEntry, options?: { players?: number; mode?: string; era?: string }): { players: number; mode: string; era: string };
export function fixtureVerdict(args: { entry: FixtureEntry; classified: { observedClass: 'qualifying' | 'all-eliminated' | 'unknown'; qualifyingSeats: number[] } }): { record: { id: string; expectedClass: string; observedClass: string; qualifyingSeats: number[] }; error: string | null };
export function fixtureStorageState(args: { base: string; code: string; secret: string; name: string }): { cookies: unknown[]; origins: { origin: string; localStorage: { name: string; value: string }[] }[] };
export function fixtureAppOrigin(args: { state: { mode?: string; base?: string; port?: number }; spec: { services?: { kind?: string; args?: string[] }[] } }): string;
export function openFixtureRun(args: { base?: string; dir: string; fixture: FixtureEntry; readJson: (file: string) => unknown; apply?: (args: { entry: FixtureEntry; run: FixtureRun; secrets: string[] }) => Promise<unknown>; launch: () => Promise<unknown>; makeSecret: () => string }): Promise<{ origin: string; secrets: string[]; browser: unknown }>;
export function classifyFixture(args: { gateSeen: boolean; gateReadySeats: number[]; allEliminated: boolean; recap: boolean }): { observedClass: 'qualifying' | 'all-eliminated' | 'unknown'; qualifyingSeats: number[] };
export function defaultConnect(target: FixtureTarget): Promise<FixtureRunner>;
export function guardOwnedRun(args: { run: FixtureRun | null; base?: string; readFile?: (path: string, encoding: string) => string; pidAlive?: (pid: number) => boolean }): FixtureTarget;
export function applyLeagueFixture(args: {
  entry: FixtureEntry;
  run: FixtureRun | null;
  connect?: (target: FixtureTarget) => Promise<FixtureRunner> | FixtureRunner;
  secrets: string[];
}): Promise<{ lobbyId: string; code: string; participantIds: string[]; target: FixtureTarget }>;
