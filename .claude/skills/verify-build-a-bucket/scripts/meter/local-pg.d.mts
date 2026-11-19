export type LocalPgTarget = { socketDir: string; port: number; database: string };
export type LocalPgRunner = {
  target: LocalPgTarget;
  query: (text: string, params?: unknown[]) => Promise<unknown[]>;
  batch: (queries: { text: string; params?: unknown[] }[]) => Promise<void>;
  transaction: (queries: { text: string; params?: unknown[] }[]) => Promise<unknown[]>;
  close: () => Promise<void>;
};

export function createRunner(target?: LocalPgTarget): Promise<LocalPgRunner>;
