import type { Player, Position } from './types';
import { hashRng, teamPickHash, type Rng } from './rng';

export interface SalColumn {
  key: string;
  label: string;
  guardTypes: string[];
  bigTypes: string[];
}

export const SAL_COLUMNS: SalColumn[] = [
  { key: 'finishing', label: 'FINISHING', guardTypes: ['finishing'], bigTypes: ['finishing'] },
  { key: 'shooting', label: 'SHOOTING', guardTypes: ['jumpShot'], bigTypes: ['jumpShot'] },
  { key: 'defense', label: 'DEFENSE', guardTypes: ['perimeterDefense'], bigTypes: ['interiorDefense'] },
  { key: 'playmaking', label: 'PLAYMAKING', guardTypes: ['handles', 'passing'], bigTypes: ['playmaking'] },
  { key: 'size', label: 'SIZE & ATHLETICISM', guardTypes: ['speed', 'bounce', 'size'], bigTypes: ['size', 'bounce'] },
];

const SAL_TIERS = [50, 40, 30, 20, 10];

const SAL_BANDS: [number, number][] = [
  [0, 0.2],
  [0.2, 0.4],
  [0.4, 0.6],
  [0.6, 0.8],
  [0.8, 1],
];

const SAL_CAP_OPTIONS = [130, 140, 150, 160, 170];

const SAL_RECENT_PENALTY = 3.5;

export interface SalCard {
  id: string;
  name: string;
  team: string;
  number: number | null;
  price: number;
  legend: boolean;
  attrs: Record<string, number>;
  fullAttrs: Record<string, number>;
  catScore: number;
  posGroup: Position;
}

const FIXED_BUDGETS: Record<string, number> = {
  '2026-07-15': 140,
  '2026-07-16': 150,
  '2026-07-17': 140,
};

export function dateSeedOf(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return (year ?? 0) * 10000 + (month ?? 0) * 100 + (day ?? 0);
}

export function budgetForDateStr(dateStr: string): number {
  const fixed = FIXED_BUDGETS[dateStr];
  if (fixed !== undefined) return fixed;
  const rng = hashRng(dateSeedOf(dateStr) ^ 0xb0b0b0);
  return SAL_CAP_OPTIONS[Math.floor(rng() * SAL_CAP_OPTIONS.length)] as number;
}

export function budgetForSeed(seedInt: number): number {
  const rng = hashRng((seedInt ^ 0xb0b0b0) | 0);
  return SAL_CAP_OPTIONS[Math.floor(rng() * SAL_CAP_OPTIONS.length)] as number;
}

export function yesterdaySeedOf(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  const before = new Date(year ?? 2026, (month ?? 1) - 1, (day ?? 1) - 1);
  return before.getFullYear() * 10000 + (before.getMonth() + 1) * 100 + before.getDate();
}

function playerPosGroup(player: Player & { posGroup?: string }): Position {
  if (player.posGroup) return player.posGroup === 'big' ? 'big' : 'guard';
  const pos = player.position;
  return pos === 'C' || pos === 'PF' ? 'big' : 'guard';
}

function salTypesFor(player: Player & { posGroup?: string }, column: SalColumn): string[] {
  return playerPosGroup(player) === 'big' ? column.bigTypes : column.guardTypes;
}

function salCatScore(player: Player & { posGroup?: string }, column: SalColumn): number {
  const types = salTypesFor(player, column);
  const total = types.reduce((sum, type) => sum + (player.attrs[type] ?? 5), 0);
  return total / types.length;
}

export function salaryPool(
  guards: Player[],
  bigs: Player[],
  legends: (Player & { posGroup?: string })[],
): (Player & { posGroup?: string; legend?: boolean })[] {
  const listed = [...guards, ...bigs, ...legends] as (Player & { posGroup?: string; legend?: boolean })[];
  const qualifying = listed.filter((player) => {
    const values = Object.values(player.attrs ?? {});
    if (!values.length) return false;
    return values.reduce((sum, value) => sum + value, 0) / values.length >= 3;
  });
  return qualifying.filter((player, index, all) => all.findIndex((other) => other.name === player.name) === index);
}

function legendTierFor(
  legend: Player & { posGroup?: string },
  column: SalColumn,
  regulars: (Player & { posGroup?: string })[],
): number {
  const score = salCatScore(legend, column);
  const sorted = regulars.map((player) => salCatScore(player, column)).sort((a, b) => b - a);
  const rank = sorted.findIndex((value) => value <= score);
  const percentile = rank === -1 ? 1 : rank / sorted.length;
  if (percentile < 0.2) return 0;
  if (percentile < 0.4) return 1;
  if (percentile < 0.6) return 2;
  if (percentile < 0.8) return 3;
  return 4;
}

interface LegendSlots {
  map: Map<string, Player & { posGroup?: string }>;
  usedLegends: Set<string>;
}

function pickLegendSlots(
  rand: Rng,
  columns: SalColumn[],
  legends: (Player & { posGroup?: string })[],
  regulars: (Player & { posGroup?: string })[],
  seed: number,
): LegendSlots {
  const year = Math.floor(seed / 10000);
  const month = Math.floor((seed % 10000) / 100);
  const day = seed % 100;
  const epoch = new Date(2026, 0, 1).getTime();
  const dayIndex = Math.round((new Date(year, month - 1, day).getTime() - epoch) / 86400000);
  const fixed = hashRng(0xbadc0ffe);
  const shuffled = [...legends];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(fixed() * (i + 1));
    const a = shuffled[i] as Player;
    const b = shuffled[j] as Player;
    shuffled[i] = b;
    shuffled[j] = a;
  }
  const count = shuffled.length;
  const first = count ? shuffled[(((dayIndex * 2) % count) + count) % count] : undefined;
  const second = count ? shuffled[(((dayIndex * 2 + 1) % count) + count) % count] : undefined;
  const usedLegends = new Set<string>();
  if (first) usedLegends.add(first.name);
  if (second) usedLegends.add(second.name);
  const firstColumn = Math.floor(rand() * columns.length);
  const secondColumn = Math.floor(rand() * columns.length);
  let firstTier = first ? legendTierFor(first, columns[firstColumn] as SalColumn, regulars) : 0;
  let secondTier = second ? legendTierFor(second, columns[secondColumn] as SalColumn, regulars) : 1;
  if (first && second && secondColumn === firstColumn && secondTier === firstTier) {
    const shift = (tier: number) => (tier < SAL_TIERS.length - 1 ? tier + 1 : tier - 1);
    const column = columns[firstColumn] as SalColumn;
    if (salCatScore(first, column) <= salCatScore(second, column)) firstTier = shift(firstTier);
    else secondTier = shift(secondTier);
  }
  const map = new Map<string, Player & { posGroup?: string }>();
  if (first) map.set(`${firstColumn}-${firstTier}`, first);
  if (second) map.set(`${secondColumn}-${secondTier}`, second);
  return { map, usedLegends };
}

function pickedNamesForSeed(
  seed: number,
  columns: SalColumn[],
  players: (Player & { posGroup?: string; legend?: boolean })[],
): Set<string> {
  const rand = hashRng(seed);
  const legends = players.filter((player) => player.legend);
  const regulars = players.filter((player) => !player.legend);
  const { map, usedLegends } = pickLegendSlots(rand, columns, legends, regulars, seed);
  const used = new Set<string>(usedLegends);
  for (const key of map.keys()) used.add((map.get(key) as Player).name);
  columns.forEach((column, columnIndex) => {
    const scored = regulars
      .map((player) => ({ name: player.name, score: salCatScore(player, column) }))
      .sort((a, b) => b.score - a.score);
    const total = scored.length;
    for (let tier = 0; tier < SAL_TIERS.length; tier++) {
      if (map.has(`${columnIndex}-${tier}`)) continue;
      const [low, high] = SAL_BANDS[tier] as [number, number];
      let pool = scored
        .slice(Math.floor(low * total), Math.max(Math.floor(low * total) + 1, Math.floor(high * total)))
        .filter((entry) => !used.has(entry.name));
      if (!pool.length) pool = scored.filter((entry) => !used.has(entry.name));
      if (!pool.length) pool = scored;
      used.add((pool[Math.floor(rand() * pool.length)] as { name: string }).name);
    }
  });
  return used;
}

function cardFor(
  player: Player & { posGroup?: string; legend?: boolean },
  column: SalColumn,
  price: number,
  score: number,
): SalCard {
  const attrs: Record<string, number> = {};
  for (const type of salTypesFor(player, column)) attrs[type] = player.attrs[type] ?? 5;
  const number = typeof player.number === 'number' ? player.number : player.number ? Number(player.number) : null;
  return {
    id: `${column.key}-${price}-${player.name}`,
    name: player.name,
    team: player.team,
    number: number !== null && Number.isFinite(number) ? number : null,
    price,
    legend: Boolean(player.legend),
    attrs,
    fullAttrs: player.attrs,
    catScore: score,
    posGroup: playerPosGroup(player),
  };
}

function generateGrid(
  columns: SalColumn[],
  players: (Player & { posGroup?: string; legend?: boolean })[],
  rand: Rng,
  recentlyUsed: Set<string> = new Set(),
  seed = 0,
): SalCard[][] {
  const legends = players.filter((player) => player.legend);
  const regulars = players.filter((player) => !player.legend);
  const { map, usedLegends } = pickLegendSlots(rand, columns, legends, regulars, seed);
  const used = new Set<string>(usedLegends);
  return columns.map((column, columnIndex) => {
    const scored = regulars
      .map((player) => ({
        player,
        score: salCatScore(player, column) - (recentlyUsed.has(player.name) ? SAL_RECENT_PENALTY : 0),
      }))
      .sort((a, b) => b.score - a.score);
    const total = scored.length;
    return SAL_TIERS.map((price, tier) => {
      const legend = map.get(`${columnIndex}-${tier}`);
      if (legend) return cardFor(legend, column, price, salCatScore(legend, column));
      const [low, high] = SAL_BANDS[tier] as [number, number];
      let pool = scored
        .slice(Math.floor(low * total), Math.max(Math.floor(low * total) + 1, Math.floor(high * total)))
        .filter((entry) => !used.has(entry.player.name));
      if (!pool.length) pool = scored.filter((entry) => !used.has(entry.player.name));
      if (!pool.length) pool = scored;
      const picked = pool[Math.floor(rand() * pool.length)] as { player: Player & { posGroup?: string }; score: number };
      used.add(picked.player.name);
      return cardFor(picked.player, column, price, picked.score);
    });
  });
}

export function dailyGrid(
  columns: SalColumn[],
  players: (Player & { posGroup?: string; legend?: boolean })[],
  dateStr: string,
): SalCard[][] {
  const recent = pickedNamesForSeed(yesterdaySeedOf(dateStr), columns, players);
  const seed = dateSeedOf(dateStr);
  return generateGrid(columns, players, hashRng(seed), recent, seed);
}

export function infiniteGrid(
  columns: SalColumn[],
  players: (Player & { posGroup?: string; legend?: boolean })[],
  seedInt: number,
): SalCard[][] {
  return generateGrid(columns, players, hashRng(seedInt), new Set(), seedInt);
}

export function teamForSeed(seedInt: number, teams: string[]): string {
  const index = Math.floor((teamPickHash(seedInt) / 4294967296) * teams.length);
  return teams[Math.min(index, teams.length - 1)] as string;
}

export function spentFor(cards: readonly SalCard[]): number {
  return cards.reduce((sum, card) => sum + card.price, 0);
}

export function buildFromCards(cards: readonly SalCard[]): { position: Position; values: Record<string, number> } {
  const values: Record<string, number> = {};
  cards.forEach((card, index) => {
    const column = SAL_COLUMNS[index] as SalColumn;
    for (const type of column.guardTypes) {
      const direct = card.attrs[type];
      const fallback = column.bigTypes.map((key) => card.attrs[key]).find((value) => value !== undefined);
      values[type] = direct ?? fallback ?? 5;
    }
  });
  const meanOf = (key: string) => {
    const found = cards.map((card) => card.fullAttrs[key]).filter((value) => value !== undefined) as number[];
    return found.length ? found.reduce((sum, value) => sum + value, 0) / found.length : 5;
  };
  values.basketballIQ = meanOf('basketballIQ');
  values.clutch = meanOf('clutch');
  values.rebounding = meanOf('rebounding');
  const sizeCard = cards[4];
  const position: Position = sizeCard && playerPosGroup(sizeCard as unknown as Player & { posGroup?: string }) === 'big' ? 'big' : 'guard';
  return { position, values };
}

export function previewFor(cards: readonly SalCard[]): { overall: number; ppg: number; apg: number; rpg: number } {
  const maxes = cards.map((card) => {
    const values = Object.values(card.attrs);
    return values.length ? Math.max(...values) : 5;
  });
  const [a = 0, b = 0, , d = 0, e = 0] = maxes;
  return {
    overall: Math.round(maxes.reduce((sum, value) => sum + value, 0)),
    ppg: Math.round((((a + b) / 2) * 2.6 + 1.8) * 10) / 10,
    apg: Math.round((d * 0.8 + 0.5) * 10) / 10,
    rpg: Math.round((e + 1.2) * 10) / 10,
  };
}
