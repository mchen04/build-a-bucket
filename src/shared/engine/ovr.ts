import { OVR_WEIGHTS } from './rules.js';
import type { Pick, Position } from './types.js';

export function computeOvr(picks: Record<string, Pick>, position: Position): number {
  return ovrFromValues(
    Object.fromEntries(Object.entries(picks).map(([attr, pick]) => [attr, pick.val])),
    position,
  );
}

export function ovrFromValues(values: Record<string, number>, position: Position): number {
  const weights = OVR_WEIGHTS[position];
  let weighted = 0;
  let total = 0;
  for (const [attr, value] of Object.entries(values)) {
    const weight = weights[attr];
    if (weight === undefined) continue;
    weighted += value * weight;
    total += weight;
  }
  if (total === 0) return 0;
  return Math.min(99, Math.round(57 + ((weighted / total - 1) / 9) * 44));
}
