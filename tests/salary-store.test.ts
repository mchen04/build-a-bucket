import { describe, expect, it } from 'vitest';
import { SALARY_KEY, readSalary, saveSalaryPlay, saveSalaryPowers, type SalaryPlay, type SalaryPowers } from '../src/shared/salaryStore';
import { SAL_COLUMNS, type SalCard } from '../src/shared/engine/salary';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function card(columnIndex: number, tier: number): SalCard {
  const column = SAL_COLUMNS[columnIndex]!;
  const attrs = Object.fromEntries(column.guardTypes.map((type, index) => [type, 3 + index + tier]));
  return {
    id: `${column.key}-${tier}-Player ${columnIndex}-${tier}`,
    name: `Player ${columnIndex}-${tier}`,
    team: 'TST',
    number: tier,
    price: 50 - tier * 10,
    legend: false,
    attrs,
    fullAttrs: attrs,
    catScore: 5,
    posGroup: 'guard',
  };
}

function powers(grid: SalCard[][] | null): SalaryPowers {
  return { shuffle: true, scout: false, grid, scouted: {} };
}

function play(dateStr: string): SalaryPlay {
  return {
    dateStr,
    cap: 150,
    spent: 100,
    ovr: 80,
    wins: 41,
    losses: 41,
    seed: 5,
    champion: false,
    madePlayoffs: true,
    headline: 'In',
    preview: { overall: 80, ppg: 20, apg: 5, rpg: 5 },
    locked: true,
    picks: [],
  };
}

describe('salary store', () => {
  it('keeps only the day being saved, so the powers entry cannot grow forever', () => {
    const storage = new MemoryStorage();
    saveSalaryPowers('2026-11-12', powers(SAL_COLUMNS.map((_, index) => [card(index, 0)])), storage);
    saveSalaryPowers('2026-11-13', powers(SAL_COLUMNS.map((_, index) => [card(index, 1)])), storage);
    const store = readSalary(storage);
    expect(Object.keys(store.powers)).toEqual(['2026-11-13']);
    expect(store.powers['2026-11-13']?.grid?.[0]?.[0]?.name).toBe('Player 0-1');
  });

  it('keeps the daily results when the powers entry is unreadable', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SALARY_KEY,
      JSON.stringify({ v: 1, daily: { '2026-11-13': play('2026-11-13') }, infinite: 3, powers: { '2026-11-13': { shuffle: 'yes' } } }),
    );
    const store = readSalary(storage);
    expect(store.daily['2026-11-13']?.locked).toBe(true);
    expect(store.infinite).toBe(3);
    expect(store.powers).toEqual({});
  });

  it('still locks the day after a bad powers entry is dropped', () => {
    const storage = new MemoryStorage();
    storage.setItem(SALARY_KEY, JSON.stringify({ v: 1, daily: {}, infinite: 0, powers: { '2026-11-13': { nope: true } } }));
    saveSalaryPlay('2026-11-13', play('2026-11-13'), storage);
    const store = readSalary(storage);
    expect(store.daily['2026-11-13']?.locked).toBe(true);
    expect(store.powers).toEqual({});
  });

  it('accepts a saved grid whose jersey number is a string', () => {
    const storage = new MemoryStorage();
    const grid = SAL_COLUMNS.map((_, index) => [{ ...card(index, 0), number: '00' as unknown as number }]);
    saveSalaryPowers('2026-11-13', powers(grid), storage);
    const store = readSalary(storage);
    expect(store.powers['2026-11-13']?.grid?.[0]?.[0]?.number).toBe(0);
  });
});
