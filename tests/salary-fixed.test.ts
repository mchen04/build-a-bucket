import { describe, expect, it } from 'vitest';
import { budgetForDateStr, dailyGrid, SAL_COLUMNS } from '../src/shared/engine/salary';
import fixed from '../src/shared/engine/salaryFixed.json';

const dates = ['2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18'];

describe('fixed salary boards', () => {
  it('uses the original four boards and budgets', () => {
    for (const date of dates) {
      const grid = dailyGrid(SAL_COLUMNS, [], date);
      const raw = fixed[date.replace(/-/g, '') as keyof typeof fixed];
      expect(grid.map((column) => column.map((card) => `${card.price}:${card.name}`))).toEqual(
        raw.map((column) => column.map((card) => `${card.price}:${card.name}`)),
      );
    }
    expect(budgetForDateStr('2026-07-15')).toBe(140);
    expect(budgetForDateStr('2026-07-16')).toBe(150);
    expect(budgetForDateStr('2026-07-17')).toBe(140);
    expect(budgetForDateStr('2026-07-18')).toBe(150);
  });
});
