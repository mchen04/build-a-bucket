import * as v from 'valibot';
import { DAILY_EPOCH, dailyPlanFor, newYorkDayKey, type DailyPlan } from './engine/daily';
import { budgetForDateStr, budgetForSeed, type SalCard } from './engine/salary';
import type { RunState } from './run';
import { RunSchema } from './data/schemas';

export const DAILY_KEY = 'bab:daily:v1';
export const SALARY_KEY = 'bab:salary:v1';
export const SQUAD_KEY = 'bab:squad:v1';

const DailySchema = v.object({
  v: v.literal(1),
  key: v.string(),
  spins: v.number(),
  done: v.boolean(),
  forfeit: v.boolean(),
  ovr: v.nullable(v.number()),
  run: v.nullable(v.any()),
});

const DailyStoreSchema = v.object({
  v: v.literal(1),
  days: v.record(v.string(), DailySchema),
});

export interface DailyDay {
  v: 1;
  key: string;
  spins: number;
  done: boolean;
  forfeit: boolean;
  ovr: number | null;
  run: RunState | null;
}

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

export function planForToday(now: Date = new Date()): DailyPlan {
  return dailyPlanFor(newYorkDayKey(now));
}

export function readDaily(storage: Storage = localStorage): Record<string, DailyDay> {
  const parsed = v.safeParse(DailyStoreSchema, readJson(storage, DAILY_KEY));
  if (!parsed.success) return {};
  return parsed.output.days as unknown as Record<string, DailyDay>;
}

export function writeDaily(days: Record<string, DailyDay>, storage: Storage = localStorage): void {
  writeJson(storage, DAILY_KEY, { v: 1, days });
}

export function dailyDay(key: string, storage: Storage = localStorage): DailyDay {
  const days = readDaily(storage);
  return days[key] ?? { v: 1, key, spins: 0, done: false, forfeit: false, ovr: null, run: null };
}

export function saveDailyDay(day: DailyDay, storage: Storage = localStorage): void {
  const days = readDaily(storage);
  writeDaily({ ...days, [day.key]: day }, storage);
}

export function dailyLocked(day: DailyDay): boolean {
  return day.done;
}

export function isBucketDay(plan: DailyPlan): boolean {
  return plan.sport === 'bucket' && plan.key >= DAILY_EPOCH;
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

const SquadSchema = v.object({
  v: v.literal(1),
  seed: v.string(),
  team: v.nullable(v.string()),
  season: v.number(),
  slots: v.array(
    v.object({
      id: v.string(),
      pos: v.picklist(['guard', 'big']),
      run: v.nullable(v.any()),
    }),
  ),
  result: v.nullable(v.any()),
});

export interface SquadSlotState {
  id: string;
  pos: 'guard' | 'big';
  run: RunState | null;
}

export interface SquadState {
  v: 1;
  seed: string;
  team: string | null;
  season: number;
  slots: SquadSlotState[];
  result: unknown;
}

export function newSquadState(seed: string): SquadState {
  return {
    v: 1,
    seed,
    team: null,
    season: 0,
    slots: [
      { id: 'PG', pos: 'guard', run: null },
      { id: 'SG', pos: 'guard', run: null },
      { id: 'SF', pos: 'guard', run: null },
      { id: 'PF', pos: 'big', run: null },
      { id: 'C', pos: 'big', run: null },
    ],
    result: null,
  };
}

export function readSquad(storage: Storage = localStorage): SquadState | null {
  const parsed = v.safeParse(SquadSchema, readJson(storage, SQUAD_KEY));
  if (!parsed.success) return null;
  const output = parsed.output as unknown as SquadState;
  const valid = v.safeParse(v.array(RunSchema), output.slots.map((slot) => slot.run).filter(Boolean));
  if (output.slots.some((slot) => slot.run) && !valid.success) return null;
  return output;
}

export function saveSquad(squad: SquadState, storage: Storage = localStorage): void {
  writeJson(storage, SQUAD_KEY, squad);
}
