import { describe, expect, it } from 'vitest';
import { archetypeFor } from '../src/shared/engine/archetype';
import { BIG_KEYS, GUARD_KEYS, picksFor } from './fixtures/pool';

function flat(keys: readonly string[], value: number): Record<string, number> {
  return Object.fromEntries(keys.map((key) => [key, value]));
}

describe('archetypeFor', () => {
  it('reports progress before the build is complete', () => {
    expect(archetypeFor(70, picksFor(GUARD_KEYS.slice(0, 4), {}), 'guard')).toBe('6 attributes remaining');
    expect(archetypeFor(70, picksFor(GUARD_KEYS.slice(0, 9), {}), 'guard')).toBe('1 attribute remaining');
  });

  it('says to spin when nothing is picked', () => {
    expect(archetypeFor(0, {}, 'guard')).toBe('Spin to start building');
    expect(archetypeFor(0, {}, 'big')).toBe('Spin to start building');
  });

  it('switches guard labels at the source bands 95/90/84/76/68', () => {
    const picks = picksFor(GUARD_KEYS, flat(GUARD_KEYS, 6));
    expect(archetypeFor(95, picks, 'guard')).toBe('Transcendent Scorer');
    expect(archetypeFor(94, picks, 'guard')).toBe('Elite Scorer');
    expect(archetypeFor(90, picks, 'guard')).toBe('Elite Scorer');
    expect(archetypeFor(89, picks, 'guard')).toBe('Sharpshooter');
    expect(archetypeFor(84, picks, 'guard')).toBe('Sharpshooter');
    expect(archetypeFor(83, picks, 'guard')).toBe('Off-Ball Scorer');
    expect(archetypeFor(76, picks, 'guard')).toBe('Off-Ball Scorer');
    expect(archetypeFor(75, picks, 'guard')).toBe('Spot-Up Shooter');
    expect(archetypeFor(68, picks, 'guard')).toBe('Spot-Up Shooter');
    expect(archetypeFor(67, picks, 'guard')).toBe('G-League Candidate');
  });

  it('switches big labels at the source bands 95/90/84/76/68', () => {
    const picks = picksFor(BIG_KEYS, flat(BIG_KEYS, 6));
    expect(archetypeFor(95, picks, 'big')).toBe('Transcendent Stretch');
    expect(archetypeFor(94, picks, 'big')).toBe('Elite Stretch');
    expect(archetypeFor(90, picks, 'big')).toBe('Elite Stretch');
    expect(archetypeFor(89, picks, 'big')).toBe('Stretch Four');
    expect(archetypeFor(84, picks, 'big')).toBe('Stretch Four');
    expect(archetypeFor(83, picks, 'big')).toBe('Stretch Forward');
    expect(archetypeFor(76, picks, 'big')).toBe('Stretch Forward');
    expect(archetypeFor(75, picks, 'big')).toBe('Spot-Up Shooter');
    expect(archetypeFor(68, picks, 'big')).toBe('Spot-Up Shooter');
    expect(archetypeFor(67, picks, 'big')).toBe('G-League Candidate');
  });

  it('reads guard archetypes from the top-attribute branches', () => {
    expect(archetypeFor(95, picksFor(GUARD_KEYS, { jumpShot: 10, handles: 10, speed: 10 }), 'guard')).toBe(
      'Untouchable Shot Creator',
    );
    expect(archetypeFor(95, picksFor(GUARD_KEYS, { handles: 10, passing: 10, basketballIQ: 10 }), 'guard')).toBe(
      'The Architect',
    );
    expect(archetypeFor(95, picksFor(GUARD_KEYS, { finishing: 10, speed: 10, bounce: 10 }), 'guard')).toBe(
      'Physical Phenomenon',
    );
    expect(archetypeFor(95, picksFor(GUARD_KEYS, { perimeterDefense: 10, jumpShot: 10, handles: 10 }), 'guard')).toBe(
      'Perfect Two-Way Guard',
    );
    expect(archetypeFor(90, picksFor(GUARD_KEYS, { jumpShot: 9, handles: 9, perimeterDefense: 5 }), 'guard')).toBe(
      'Elite Shot Creator',
    );
    expect(
      archetypeFor(90, picksFor(GUARD_KEYS, { jumpShot: 9, perimeterDefense: 9, handles: 5 }), 'guard'),
    ).toBe('Premier Two-Way Guard');
    expect(archetypeFor(84, picksFor(GUARD_KEYS, { jumpShot: 8, perimeterDefense: 8 }), 'guard')).toBe(
      '3-and-D Wing',
    );
    expect(archetypeFor(76, picksFor(GUARD_KEYS, { jumpShot: 9, perimeterDefense: 7, handles: 3 }), 'guard')).toBe(
      '3-and-D Specialist',
    );
    expect(archetypeFor(68, picksFor(GUARD_KEYS, { jumpShot: 8, speed: 3, finishing: 3 }), 'guard')).toBe(
      'Corner Three Specialist',
    );
    expect(archetypeFor(80, picksFor(GUARD_KEYS, { jumpShot: 11, speed: 2, finishing: 2 }), 'guard')).toBe(
      'Sharpshooter',
    );
  });

  it('reads big archetypes from the top-attribute branches', () => {
    expect(archetypeFor(95, picksFor(BIG_KEYS, { jumpShot: 10, finishing: 10, interiorDefense: 10 }), 'big')).toBe(
      'Unstoppable Two-Way Big',
    );
    expect(archetypeFor(95, picksFor(BIG_KEYS, { finishing: 10, rebounding: 10, interiorDefense: 10 }), 'big')).toBe(
      'Dominant Anchor',
    );
    expect(archetypeFor(95, picksFor(BIG_KEYS, { playmaking: 10, basketballIQ: 10, jumpShot: 10 }), 'big')).toBe(
      'Unicorn Point-Center',
    );
    expect(archetypeFor(90, picksFor(BIG_KEYS, { finishing: 10, bounce: 10, size: 3 }), 'big')).toBe(
      'High-Flying Post Beast',
    );
    expect(archetypeFor(84, picksFor(BIG_KEYS, { interiorDefense: 9, rebounding: 9, speed: 4 }), 'big')).toBe(
      'Glass-Eating Anchor',
    );
    expect(archetypeFor(76, picksFor(BIG_KEYS, { rebounding: 9, jumpShot: 4, finishing: 4 }), 'big')).toBe(
      'Glass Cleaner',
    );
    expect(archetypeFor(68, picksFor(BIG_KEYS, { rebounding: 9, jumpShot: 3, finishing: 3 }), 'big')).toBe(
      'Rebounding Machine',
    );
  });

  it('uses the balanced branch only for flat, high builds', () => {
    const balanced = picksFor(GUARD_KEYS, flat(GUARD_KEYS, 9));
    balanced.jumpShot = { attr: 'jumpShot', val: 8, playerName: 'Test', playerShort: 'Test', team: 'AAA' };
    expect(archetypeFor(95, balanced, 'guard')).toBe('Generational Superstar');
    expect(archetypeFor(95, picksFor(GUARD_KEYS, { jumpShot: 1, finishing: 10, speed: 10, bounce: 10 }), 'guard')).toBe(
      'Physical Phenomenon',
    );
  });
});
