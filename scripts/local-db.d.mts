export type LocalDbHandle = {
  dataDir: string;
  pgPort: number;
  database: string;
  url: string;
  runnerPath: string;
  root: string;
  remove: boolean;
  child?: unknown;
};

export function localDbEnv(handle: LocalDbHandle): Record<string, string>;
export function createStopOnce<T>(stop: () => Promise<T>): () => Promise<T>;
export function prepareLocalDb(options?: Record<string, unknown>): Omit<LocalDbHandle, 'child'>;
export function startLocalDb(options?: Record<string, unknown>): Promise<LocalDbHandle>;
export function stopLocalDb(handle: LocalDbHandle): Promise<{ state: string; reason: string | null }>;
export function main(options?: Record<string, unknown>): Promise<void>;
