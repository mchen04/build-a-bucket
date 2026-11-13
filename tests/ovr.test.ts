import { describe, expect, it } from 'vitest';
import { computeOvr } from '../src/shared/engine/ovr';
import type { Pick } from '../src/shared/engine/types';
import { BIG_KEYS, GUARD_KEYS, picksFor } from './fixtures/pool';

function valuesFor(keys: readonly string[], base: number, overrides: Record<string, number>): Record<string, number> {
  return { ...Object.fromEntries(keys.map((key) => [key, base])), ...overrides };
}

describe('computeOvr', () => {
  it('returns 0 for an empty build', () => {
    expect(computeOvr({}, 'guard')).toBe(0);
    expect(computeOvr({}, 'big')).toBe(0);
  });

  it('matches the hand-computed flat guard build (all 9)', () => {
    expect(computeOvr(picksFor(GUARD_KEYS, valuesFor(GUARD_KEYS, 9, {})), 'guard')).toBe(96);
  });

  it('matches a hand-computed mixed guard build', () => {
    const values = valuesFor(GUARD_KEYS, 6, {
      jumpShot: 7,
      finishing: 6,
      passing: 5,
      handles: 5,
      perimeterDefense: 4,
      speed: 8,
      bounce: 6,
      size: 5,
      basketballIQ: 7,
      clutch: 9,
    });
    expect(computeOvr(picksFor(GUARD_KEYS, values), 'guard')).toBe(82);
  });

  it('matches a hand-computed low guard build', () => {
    expect(computeOvr(picksFor(GUARD_KEYS, valuesFor(GUARD_KEYS, 1, { clutch: 11 })), 'guard')).toBe(58);
  });

  it('caps at 99', () => {
    expect(computeOvr(picksFor(GUARD_KEYS, valuesFor(GUARD_KEYS, 11, {})), 'guard')).toBe(99);
    expect(computeOvr(picksFor(BIG_KEYS, valuesFor(BIG_KEYS, 11, {})), 'big')).toBe(99);
  });

  it('matches a hand-computed mixed big build', () => {
    const values = valuesFor(BIG_KEYS, 5, {
      jumpShot: 5,
      finishing: 8,
      rebounding: 6,
      playmaking: 3,
      interiorDefense: 7,
      speed: 7,
      bounce: 4,
      size: 9,
      basketballIQ: 8,
      clutch: 2,
    });
    expect(computeOvr(picksFor(BIG_KEYS, values), 'big')).toBe(84);
  });

  it('matches a hand-computed low big build', () => {
    expect(computeOvr(picksFor(BIG_KEYS, valuesFor(BIG_KEYS, 2, {})), 'big')).toBe(62);
  });

  it('weights only the attributes that are present', () => {
    const picks: Record<string, Pick> = {
      jumpShot: { attr: 'jumpShot', val: 11, playerName: 'A', playerShort: 'A', team: 'AAA' },
    };
    expect(computeOvr(picks, 'guard')).toBe(99);
    expect(computeOvr(picks, 'big')).toBe(99);
  });

  it('uses the per-position weight table', () => {
    expect(computeOvr(picksFor(GUARD_KEYS, valuesFor(GUARD_KEYS, 5, { speed: 11 })), 'guard')).toBe(81);
    expect(computeOvr(picksFor(BIG_KEYS, valuesFor(BIG_KEYS, 5, { speed: 11 })), 'big')).toBe(79);
  });
});
