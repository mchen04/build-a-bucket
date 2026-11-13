import { OVR_WEIGHTS } from './rules';
import type { Pick, Position } from './types';

export function computeOvr(picks: Record<string, Pick>, position: Position): number {
  const weights = OVR_WEIGHTS[position];
  let weighted = 0;
  let total = 0;
  for (const [attr, pick] of Object.entries(picks)) {
    const weight = weights[attr];
    if (weight === undefined) continue;
    weighted += pick.val * weight;
    total += weight;
  }
  if (total === 0) return 0;
  return Math.min(99, Math.round(57 + ((weighted / total - 1) / 9) * 44));
}
