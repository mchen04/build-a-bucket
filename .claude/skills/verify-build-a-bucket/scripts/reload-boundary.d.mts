export type ReloadSeat = { seat: number; name: string };
export type ReloadProof = { classification: string; reason?: string | null; attempts: unknown[] };

export function recordNoBoundary(args: {
  seat: ReloadSeat;
  other: ReloadSeat | null;
  snapReload: (seat: ReloadSeat, phase: string) => Promise<void>;
  proof: ReloadProof;
  ev: string;
  reload: Record<string, unknown>;
}): Promise<void>;
