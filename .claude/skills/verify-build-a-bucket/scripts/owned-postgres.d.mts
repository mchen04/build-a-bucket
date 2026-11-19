export function socketPath(sockDir: string, port: number): string;
export function checkSocketPath(sockDir: string, port: number): string;
export function ownedPostgresEnv(fields: { sockDir: string; port: number; database: string }): Record<string, string>;
export function createOwnedPostgres(options: {
  root: string;
  port: number;
  database?: string;
  schema?: string;
  spawn?: unknown;
  psql?: (sql: string, db?: string) => string;
  initdb?: (dirs: { dataDir: string; sockDir: string; port: number }) => void;
  schemaLoad?: () => void;
  clock?: { setTimeout: (fn: () => void, ms: number) => unknown };
  onChild?: (child: unknown, port: number) => void;
  reuse?: boolean;
  logPath?: string;
}): Promise<{ dataDir: string; sockDir: string; port: number; database: string; child: unknown; env: Record<string, string> }>;
