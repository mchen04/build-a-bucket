import { describe, expect, it } from 'vitest';
import { gradeFor } from '../src/shared/engine/rules';
import { SAL_COLUMNS, buildFromCards, previewFor, type SalCard } from '../src/shared/engine/salary';
import { scoutGrade, shuffleColumn, shuffleRow } from '../src/shared/engine/salaryPowers';

const PRICES = [50, 40, 30, 20, 10];
const ALL_ATTRS = [
  'jumpShot',
  'finishing',
  'passing',
  'handles',
  'perimeterDefense',
  'speed',
  'bounce',
  'size',
  'basketballIQ',
  'clutch',
  'rebounding',
  'playmaking',
  'interiorDefense',
];

function card(columnIndex: number, tier: number): SalCard {
  const column = SAL_COLUMNS[columnIndex]!;
  const types = column.guardTypes;
  const attrs = Object.fromEntries(types.map((type, index) => [type, 3 + index + tier]));
  const fullAttrs = Object.fromEntries(ALL_ATTRS.map((key, index) => [key, 2 + ((index + tier + columnIndex) % 10)]));
  return {
    id: `${column.key}-${PRICES[tier]}-Player ${columnIndex}-${tier}`,
    name: `Player ${columnIndex}-${tier}`,
    team: 'TST',
    number: null,
    price: PRICES[tier]!,
    legend: false,
    attrs,
    fullAttrs,
    catScore: types.reduce((sum, type) => sum + (attrs[type] ?? 5), 0) / types.length,
    posGroup: 'guard',
  };
}

function grid(): SalCard[][] {
  return SAL_COLUMNS.map((_, columnIndex) => PRICES.map((_, tier) => card(columnIndex, tier)));
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('salary powers', () => {
  it('deranges a column and moves each card to its new price', () => {
    const before = grid();
    const after = shuffleColumn(before, 2, seeded(7));
    const names = before[2]!.map((entry) => entry.name);
    expect(after[2]!.map((entry) => entry.name).sort()).toEqual([...names].sort());
    after[2]!.forEach((entry, tier) => {
      expect(entry.name, `tier ${tier} keeps its card`).not.toBe(before[2]![tier]!.name);
      expect(entry.price).toBe(PRICES[tier]);
      const source = before[2]!.find((old) => old.name === entry.name)!;
      expect(entry.attrs).toEqual(source.attrs);
      expect(entry.id).toBe(`${SAL_COLUMNS[2]!.key}-${PRICES[tier]}-${entry.name}`);
    });
    before[0]!.forEach((entry, tier) => expect(after[0]![tier]).toEqual(entry));
  });

  it('deranges a row and switches the shown attributes to the new columns', () => {
    const before = grid();
    const after = shuffleRow(before, 1, seeded(11));
    const names = before.map((column) => column[1]!.name);
    expect(after.map((column) => column[1]!.name).sort()).toEqual([...names].sort());
    after.forEach((column, columnIndex) => {
      const entry = column[1]!;
      expect(entry.name, `column ${columnIndex} keeps its card`).not.toBe(before[columnIndex]![1]!.name);
      expect(entry.price).toBe(PRICES[1]);
      expect(entry.id).toBe(`${SAL_COLUMNS[columnIndex]!.key}-${PRICES[1]}-${entry.name}`);
      const types = SAL_COLUMNS[columnIndex]!.guardTypes;
      expect(Object.keys(entry.attrs).sort()).toEqual([...types].sort());
      for (const type of types) expect(entry.attrs[type]).toBe(entry.fullAttrs[type] ?? 5);
    });
    expect(after[0]![0]!.name).toBe(before[0]![0]!.name);
  });

  it('scouts the mean of the shown attributes on the player grade scale', () => {
    const entry = card(1, 0);
    const values = Object.values(entry.attrs);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(scoutGrade(entry)).toBe(gradeFor(mean));
  });

  it('keys a scouted grade to the card as shown, so a row shuffle drops it', () => {
    const before = grid();
    const scoutedCard = before[1]![2]!;
    const scouted: Record<string, string> = { [scoutedCard.id]: scoutGrade(scoutedCard) };
    const after = shuffleRow(before, 2, seeded(11));
    const moved = after[1]![2]!;
    expect(moved.name).not.toBe(scoutedCard.name);
    expect(moved.id).not.toBe(scoutedCard.id);
    expect(scouted[moved.id]).toBeUndefined();
    expect(scouted[scoutedCard.id]).toBe(scoutGrade(scoutedCard));
  });

  it('keys a scouted grade to the card as shown, so a column shuffle drops it', () => {
    const before = grid();
    const scoutedCard = before[2]![1]!;
    const scouted: Record<string, string> = { [scoutedCard.id]: scoutGrade(scoutedCard) };
    const after = shuffleColumn(before, 2, seeded(7));
    const moved = after[2]![1]!;
    expect(moved.name).not.toBe(scoutedCard.name);
    expect(scouted[moved.id]).toBeUndefined();
  });

  it('builds the result from the shuffled cards', () => {
    const before = grid();
    const after = shuffleRow(before, 0, seeded(5));
    const beforeCards = before.map((column) => column[0]!);
    const afterCards = after.map((column) => column[0]!);
    expect(buildFromCards(afterCards)).not.toEqual(buildFromCards(beforeCards));
    expect(previewFor(afterCards)).not.toEqual(previewFor(beforeCards));
  });
});
