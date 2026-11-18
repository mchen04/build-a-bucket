export type PlanRun = {
  name: string;
  players: number;
  mode: string;
  device: string;
  reloadSeat: number | null;
  awaySeat: number | null;
  hostLeave: boolean;
  args: string[];
  command?: string;
};
export type Plan = { suite: { id: string; command: string[] }[]; runs: PlanRun[] };

export function buildLeagueSummary(fields: Record<string, unknown>): Record<string, unknown>;
export function buildRunRecord(run: PlanRun): Record<string, unknown>;
export function buildMetaRecord(fields: { head: string; out: string; babVerifyHome: string; port: number; e2ePort: number; suitePgPort: number }): Record<string, unknown>;
export function buildTrackedRecord(fields: { pid: number; port: number; pgPort?: number | null }): Record<string, unknown>;
export function buildCleanupLines(fields: { pid: number; pgPort?: number | null; e2ePort?: number | null; suitePgPort?: number | null; probes: Record<string, string> }): string[];
export function buildControlSummary(run: PlanRun): Record<string, unknown>;
export function buildControlFixture(fields: { out: string; plan: Plan; head: string; pid?: number; port?: number; pgPort?: number; e2ePort?: number; suitePgPort?: number }): string;
export function selectRunDir(options: { out: string; launchAttempted: boolean; verifyHome: string }): string;
