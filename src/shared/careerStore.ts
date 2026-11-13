import * as v from 'valibot';
import type { Career } from './engine/career/core';
import { careerTotals, legacyOf } from './engine/career/engine';

export const CAREER_KEY = 'bab:career:v1';
export const CAREER_HISTORY_KEY = 'bab:career:history:v1';
export const CAREER_SLOTS = 5;
export const HISTORY_LIMIT = 20;

const CareerSchema = v.looseObject({
  v: v.literal(1),
  seed: v.string(),
  pos: v.picklist(['guard', 'big']),
  name: v.string(),
  games: v.picklist(['simple', 'off']),
  build: v.record(v.string(), v.object({ val: v.number() })),
  ovr: v.number(),
  age: v.number(),
  year: v.number(),
  season: v.number(),
  phase: v.picklist(['draft', 'preseason', 'season', 'offseason', 'retired']),
  draft: v.looseObject({ combine: v.array(v.any()), interviews: v.array(v.any()) }),
  seasons: v.array(v.any()),
  injuries: v.array(v.any()),
  decisions: v.array(v.any()),
  dev: v.object({ points: v.number(), spent: v.number() }),
  durability: v.number(),
  rep: v.number(),
  earnings: v.number(),
});

const SlotsSchema = v.object({
  v: v.literal(1),
  slots: v.array(v.nullable(v.unknown())),
});

const HistoryEntrySchema = v.object({
  name: v.string(),
  pos: v.picklist(['guard', 'big']),
  seasons: v.number(),
  rings: v.number(),
  awards: v.number(),
  ovr: v.number(),
  legacy: v.number(),
  hof: v.boolean(),
  at: v.number(),
  seed: v.string(),
});

export interface HistoryEntry {
  name: string;
  pos: 'guard' | 'big';
  seasons: number;
  rings: number;
  awards: number;
  ovr: number;
  legacy: number;
  hof: boolean;
  at: number;
  seed: string;
}

export interface SlotSummary {
  index: number;
  name: string;
  pos: 'guard' | 'big';
  team: string | null;
  season: number;
  year: number;
  age: number;
  ovr: number;
  phase: Career['phase'];
  legacy: number;
  rings: number;
  awards: number;
  hof: boolean;
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

function validCareer(value: unknown): Career | null {
  const parsed = v.safeParse(CareerSchema, value);
  if (!parsed.success) return null;
  return parsed.output as unknown as Career;
}

export function readSlots(storage: Storage = localStorage): (Career | null)[] {
  const parsed = v.safeParse(SlotsSchema, readJson(storage, CAREER_KEY));
  if (!parsed.success) return Array.from({ length: CAREER_SLOTS }, () => null);
  return Array.from({ length: CAREER_SLOTS }, (_, index) => validCareer((parsed.output.slots as unknown[])[index] ?? null));
}

export function writeSlot(index: number, career: Career, storage: Storage = localStorage): void {
  const slots = readSlots(storage);
  slots[index] = career;
  writeJson(storage, CAREER_KEY, { v: 1, slots });
}

export function clearSlot(index: number, storage: Storage = localStorage): void {
  const slots = readSlots(storage);
  slots[index] = null;
  writeJson(storage, CAREER_KEY, { v: 1, slots });
}

export function readHistory(storage: Storage = localStorage): HistoryEntry[] {
  const raw = readJson(storage, CAREER_HISTORY_KEY);
  const parsed = v.safeParse(v.object({ v: v.literal(1), list: v.array(HistoryEntrySchema) }), raw);
  if (!parsed.success) return [];
  return parsed.output.list as HistoryEntry[];
}

export function pushHistory(entry: HistoryEntry, storage: Storage = localStorage): HistoryEntry[] {
  const list = [entry, ...readHistory(storage)].slice(0, HISTORY_LIMIT);
  writeJson(storage, CAREER_HISTORY_KEY, { v: 1, list });
  return list;
}

export function historyEntry(career: Career): HistoryEntry {
  const totals = careerTotals(career);
  return {
    name: career.name,
    pos: career.pos,
    seasons: totals.seasons,
    rings: totals.rings,
    awards: totals.awards,
    ovr: career.ovr,
    legacy: legacyOf(career).score,
    hof: !!career.hof?.in,
    at: Date.now(),
    seed: career.seed,
  };
}

export function summarize(index: number, career: Career | null): SlotSummary | null {
  if (!career) return null;
  const totals = careerTotals(career);
  return {
    index,
    name: career.name,
    pos: career.pos,
    team: career.team,
    season: career.season,
    year: career.year + 1,
    age: career.age,
    ovr: career.ovr,
    phase: career.phase,
    legacy: legacyOf(career).score,
    rings: totals.rings,
    awards: totals.awards,
    hof: !!career.hof?.in,
  };
}

export function phaseLabel(career: Career): string {
  if (career.phase === 'draft') return career.step === 'combine' ? 'Combine' : career.step === 'interviews' ? 'Interviews' : 'Draft day';
  if (career.phase === 'preseason') return `Year ${career.year + 1} · preseason`;
  if (career.phase === 'season') return `Year ${career.year + 1} · ${career.season} season`;
  if (career.phase === 'offseason') return `Offseason ${career.season}`;
  return `Retired · ${legacyOf(career).tier}`;
}
