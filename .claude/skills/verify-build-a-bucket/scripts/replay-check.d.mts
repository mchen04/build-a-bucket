export type ReplayCheckResult = {
  ok: boolean;
  rows: { name: string; failures: string[] }[];
  failures: string[];
  refreshProofs: number;
};

export function checkReplay(options: { out: string; planPath: string; expectedHead?: string | null; cleanup?: boolean }): ReplayCheckResult;
export function checkNoBoundaryContract(args: { reload: Record<string, unknown>; attempts: Record<string, unknown> | null; stages: unknown[] }): string[];
export function runReplayCheck(argv: string[]): void;
