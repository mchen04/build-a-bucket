import { gradeFor } from './rules.js';
import { SAL_COLUMNS, type SalCard, type SalColumn } from './salary.js';

export type ShuffleTarget = { kind: 'column'; index: number } | { kind: 'row'; tier: number };

function derangement(size: number, rand: () => number): number[] {
  for (let attempt = 0; attempt < 200; attempt++) {
    const order = Array.from({ length: size }, (_, index) => index);
    for (let i = size - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const a = order[i] as number;
      const b = order[j] as number;
      order[i] = b;
      order[j] = a;
    }
    if (order.every((value, index) => value !== index)) return order;
  }
  return Array.from({ length: size }, (_, index) => (index + 1) % size);
}

export function shuffleColumn(grid: SalCard[][], columnIndex: number, rand: () => number): SalCard[][] {
  const column = grid[columnIndex];
  if (!column || column.length < 2) return grid;
  const order = derangement(column.length, rand);
  const next = grid.map((entry) => [...entry]);
  next[columnIndex] = order.map((source, tier) => {
    const card = column[source] as SalCard;
    const price = column[tier]?.price ?? card.price;
    return { ...card, price, id: `${SAL_COLUMNS[columnIndex]?.key}-${price}-${card.name}` };
  });
  return next;
}

export function shuffleRow(grid: SalCard[][], tier: number, rand: () => number): SalCard[][] {
  const row = grid.map((column) => column[tier]).filter((card): card is SalCard => Boolean(card));
  if (row.length !== grid.length || row.length < 2) return grid;
  const order = derangement(row.length, rand);
  const next = grid.map((entry) => [...entry]);
  order.forEach((source, columnIndex) => {
    const card = row[source] as SalCard;
    const column = SAL_COLUMNS[columnIndex] as SalColumn;
    const types = card.posGroup === 'big' ? column.bigTypes : column.guardTypes;
    const attrs: Record<string, number> = {};
    for (const type of types) attrs[type] = card.fullAttrs[type] ?? 5;
    const catScore = types.reduce((sum, type) => sum + (attrs[type] ?? 5), 0) / types.length;
    next[columnIndex]![tier] = { ...card, id: `${column.key}-${card.price}-${card.name}`, attrs, catScore };
  });
  return next;
}

export function scoutGrade(card: SalCard): string {
  const values = Object.values(card.attrs);
  if (!values.length) return 'C';
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return gradeFor(mean);
}
