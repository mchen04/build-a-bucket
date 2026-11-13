import { describe, expect, it } from 'vitest';
import {
  SAL_COLUMNS,
  budgetForDateStr,
  budgetForSeed,
  buildFromCards,
  dailyGrid,
  dateSeedOf,
  infiniteGrid,
  previewFor,
  salaryPool,
  teamForSeed,
  yesterdaySeedOf,
} from '../src/shared/engine/salary';
import { GOLDEN_CAPS, GOLDEN_GRIDS, GOLDEN_POOL, GOLDEN_TEAMS } from './fixtures/golden';
import { SAL_BIGS, SAL_GUARDS, SAL_LEGENDS, SAL_TEAM_SHORTS } from './fixtures/modes';

const pool = salaryPool(SAL_GUARDS, SAL_BIGS, SAL_LEGENDS);

function gridNames(grid: ReturnType<typeof dailyGrid>): string[][] {
  return grid.map((column) => column.map((card) => `${card.name}|${card.legend ? 'L' : 'P'}`));
}

describe('salary cap pool', () => {
  it('keeps the traced order, dropping weak cards and duplicate names', () => {
    expect(pool.map((player) => player.name)).toEqual([...GOLDEN_POOL]);
    expect(pool.some((player) => player.name === 'Fay Quinn')).toBe(false);
    expect(pool.filter((player) => player.name === 'Gus Reed')).toHaveLength(1);
  });
});

describe('salary cap budget', () => {
  it('matches the traced cap for each date', () => {
    for (const expected of GOLDEN_CAPS) {
      expect(budgetForDateStr(expected.date)).toBe(expected.cap);
    }
  });

  it('uses the seed for infinite runs', () => {
    expect(budgetForSeed(20261113)).toBe(budgetForDateStr('2026-11-13'));
    expect([130, 140, 150, 160, 170]).toContain(budgetForSeed(4242));
  });

  it('reads the day before as the previous day seed', () => {
    expect(yesterdaySeedOf('2026-11-13')).toBe(20261112);
    expect(yesterdaySeedOf('2026-03-01')).toBe(20260228);
  });
});

describe('salary cap grid', () => {
  it('deals the traced board for each day', () => {
    for (const [date, expected] of Object.entries(GOLDEN_GRIDS)) {
      expect(gridNames(dailyGrid(SAL_COLUMNS, pool, date))).toEqual(expected);
    }
  });

  it('is deterministic and price-locked per tier', () => {
    const first = dailyGrid(SAL_COLUMNS, pool, '2026-11-13');
    const second = dailyGrid(SAL_COLUMNS, pool, '2026-11-13');
    expect(gridNames(second)).toEqual(gridNames(first));
    for (const column of first) {
      expect(column.map((card) => card.price)).toEqual([50, 40, 30, 20, 10]);
    }
  });

  it('deals an infinite board from the seed', () => {
    const grid = infiniteGrid(SAL_COLUMNS, pool, 123456789);
    expect(grid).toHaveLength(5);
    expect(gridNames(grid)).toEqual(gridNames(infiniteGrid(SAL_COLUMNS, pool, 123456789)));
  });
});

describe('salary cap play', () => {
  it('picks the team from the seed', () => {
    for (const expected of GOLDEN_TEAMS) {
      expect(teamForSeed(expected.seed, SAL_TEAM_SHORTS)).toBe(expected.team);
    }
  });

  it('builds the guard keys with big-column fallbacks and positional averages', () => {
    const cards = SAL_COLUMNS.map((column) => dailyGrid([column], pool, '2026-11-13')[0]?.[0]);
    const { position, values } = buildFromCards(cards as NonNullable<(typeof cards)[number]>[]);
    expect(['guard', 'big']).toContain(position);
    expect(values.basketballIQ).toBeGreaterThan(0);
    expect(values.clutch).toBeGreaterThan(0);
    expect(values.rebounding).toBeGreaterThan(0);
    expect(values.jumpShot).toBeGreaterThanOrEqual(0);
    expect(values.speed).toBeGreaterThanOrEqual(0);
  });

  it('reads the preview from the column maximums', () => {
    const cards = SAL_COLUMNS.map((column) => dailyGrid([column], pool, '2026-11-13')[0]?.[0]);
    const preview = previewFor(cards as NonNullable<(typeof cards)[number]>[]);
    expect(preview.overall).toBeGreaterThan(0);
    expect(preview.overall).toBeLessThanOrEqual(55);
    expect(preview.ppg).toBeGreaterThan(preview.apg);
  });

  it('reads the date seed as yyyymmdd', () => {
    expect(dateSeedOf('2026-11-13')).toBe(20261113);
  });
});
