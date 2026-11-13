import { describe, expect, it } from 'vitest';
import { GENERIC_DARK, GENERIC_LIGHT, photoFor, type Catalog } from '../src/shared/data/loader';
import { heightLabel, valueLabel, weightLabel } from '../src/shared/engine/rules';
import type { Player } from '../src/shared/engine/types';
import { createRun, heightWeightFor, openOptions, pickOptions, placePick } from '../src/shared/run';
import { GUARD_KEYS } from './fixtures/pool';

const player: Player = {
  name: 'Fixture Player',
  short: 'Fixture',
  team: 'AAA',
  number: 7,
  height: 81,
  weight: 245,
  skin: '#f0d0b0',
  attrs: Object.fromEntries(GUARD_KEYS.map((key) => [key, 5])),
};

const catalog: Catalog = {
  teams: [{ short: 'AAA', name: 'Alpha', color: '#111111', color2: '#222222' }],
  currentGuards: [player],
  currentBigs: [],
  legendGuards: [],
  legendBigs: [],
  salaryLegends: [],
  headshots: { 'Fixture Player': '12345' },
};

describe('pick options', () => {
  it('offers every still-empty trait with that player value', () => {
    const run = createRun('b-options', 'guard', 'current');
    const options = pickOptions(run, player);
    expect(options).toHaveLength(10);
    expect(options.map((option) => option.attr)).toEqual([...GUARD_KEYS]);
    expect(options.every((option) => !option.filled)).toBe(true);
    expect(options[0]?.val).toBe(5);
    expect(options[0]?.label).toBe('Jump Shot');
    expect(options[0]?.short).toBe('JMP');
  });

  it('marks filled traits as taken and keeps them visible', () => {
    let run = createRun('b-options', 'guard', 'current');
    run = placePick(run, player, 'jumpShot', photoFor(catalog, player));
    run = placePick(run, player, 'clutch', photoFor(catalog, player));
    const options = pickOptions(run, player);
    expect(options).toHaveLength(10);
    expect(options.filter((option) => option.filled).map((option) => option.attr)).toEqual(['jumpShot', 'clutch']);
    expect(openOptions(options).map((option) => option.attr)).not.toContain('jumpShot');
    expect(openOptions(options)).toHaveLength(8);
  });

  it('reports no open slots once every trait of the player is taken', () => {
    let run = createRun('b-options', 'guard', 'current');
    for (const key of GUARD_KEYS) run = placePick(run, player, key, photoFor(catalog, player));
    expect(openOptions(pickOptions(run, player))).toHaveLength(0);
    expect(Object.keys(run.picks)).toHaveLength(10);
  });

  it('never moves a filled slot', () => {
    const run = placePick(createRun('b-options', 'guard', 'current'), player, 'jumpShot');
    const other: Player = { ...player, name: 'Other', attrs: { ...player.attrs, jumpShot: 11 } };
    expect(placePick(run, other, 'jumpShot')).toBe(run);
    expect(run.picks.jumpShot?.val).toBe(5);
  });
});

describe('build measurements', () => {
  it('reads height and weight from the size pick', () => {
    let run = createRun('b-size', 'guard', 'current');
    expect(heightWeightFor(run)).toEqual({ height: null, weight: null });
    run = placePick(run, player, 'size');
    expect(heightWeightFor(run)).toEqual({ height: 81, weight: 245 });
    expect(heightLabel(81)).toBe(`6'9"`);
    expect(weightLabel(245)).toBe('245 lb');
    expect(heightLabel(null)).toBeNull();
  });

  it('shows letters or numbers for the same value', () => {
    expect(valueLabel(11, true)).toBe('S');
    expect(valueLabel(11, false)).toBe('11');
    expect(valueLabel(0, true)).toBe('F');
  });

  it('stores the source player photo, height and weight on the pick', () => {
    const run = placePick(createRun('b-photo', 'guard', 'current'), player, 'jumpShot', photoFor(catalog, player));
    expect(run.picks.jumpShot?.photo).toMatch(/\/public\/headshots\/nba\/12345\.webp$/);
    expect(run.picks.jumpShot?.playerName).toBe('Fixture Player');
    expect(run.picks.jumpShot?.height).toBe(81);
    expect(run.picks.jumpShot?.weight).toBe(245);
  });
});

describe('player photos', () => {
  it('uses the pinned headshot when the name is in the map', () => {
    expect(photoFor(catalog, player)).toMatch(/\/public\/headshots\/nba\/12345\.webp$/);
  });

  it('falls back to the generic art by skin luminance', () => {
    const unknownName: Player = { ...player, name: 'Nobody Known', skin: '#f8f8f8' };
    expect(photoFor(catalog, unknownName)).toBe(GENERIC_LIGHT);
    expect(photoFor(catalog, { ...unknownName, skin: '#101010' })).toBe(GENERIC_DARK);
    expect(photoFor(catalog, { ...unknownName, skin: undefined })).toBe(GENERIC_DARK);
    expect(photoFor(catalog, { ...unknownName, skin: '#fff' })).toBe(GENERIC_LIGHT);
  });
});
