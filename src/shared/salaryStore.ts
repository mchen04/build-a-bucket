import * as v from 'valibot';
import { budgetForDateStr, budgetForSeed, type SalCard } from './engine/salary';

export const SALARY_KEY = 'bab:salary:v1';

function readJson(storage: Storage, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

const SalarySchema = v.object({
  v: v.literal(1),
  daily: v.record(
    v.string(),
    v.object({
      dateStr: v.string(),
      cap: v.number(),
      spent: v.number(),
      ovr: v.number(),
      wins: v.number(),
      losses: v.number(),
      seed: v.number(),
      champion: v.boolean(),
      madePlayoffs: v.boolean(),
      headline: v.string(),
      preview: v.object({ overall: v.number(), ppg: v.number(), apg: v.number(), rpg: v.number() }),
      locked: v.boolean(),
      picks: v.array(v.object({ name: v.string(), price: v.number(), team: v.string() })),
    }),
  ),
  infinite: v.number(),
});

export interface SalaryPlay {
  dateStr: string;
  cap: number;
  spent: number;
  ovr: number;
  wins: number;
  losses: number;
  seed: number;
  champion: boolean;
  madePlayoffs: boolean;
  headline: string;
  preview: { overall: number; ppg: number; apg: number; rpg: number };
  locked: boolean;
  picks: { name: string; price: number; team: string }[];
}

export interface SalaryStore {
  v: 1;
  daily: Record<string, SalaryPlay>;
  infinite: number;
}

export function readSalary(storage: Storage = localStorage): SalaryStore {
  const parsed = v.safeParse(SalarySchema, readJson(storage, SALARY_KEY));
  if (!parsed.success) return { v: 1, daily: {}, infinite: 0 };
  const output = parsed.output as unknown as SalaryStore;
  return { v: 1, daily: output.daily ?? {}, infinite: output.infinite ?? 0 };
}

export function saveSalaryPlay(dateStr: string, play: SalaryPlay, storage: Storage = localStorage): void {
  const store = readSalary(storage);
  writeJson(storage, SALARY_KEY, { ...store, daily: { ...store.daily, [dateStr]: play } });
}

export function bumpInfinite(storage: Storage = localStorage): void {
  const store = readSalary(storage);
  writeJson(storage, SALARY_KEY, { ...store, infinite: store.infinite + 1 });
}

export function salaryCapFor(dateStr: string, seedInt?: number): number {
  return seedInt === undefined ? budgetForDateStr(dateStr) : budgetForSeed(seedInt);
}

export function cardSummary(cards: readonly SalCard[]): SalaryPlay['picks'] {
  return cards.map((card) => ({ name: card.name, price: card.price, team: card.team }));
}
