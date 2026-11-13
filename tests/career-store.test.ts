import { describe, expect, it } from 'vitest';
import { CAREER_HISTORY_KEY, CAREER_KEY, CAREER_SLOTS, HISTORY_LIMIT, clearSlot, historyEntry, pushHistory, readHistory, readSlots, summarize, writeSlot, type HistoryEntry } from '../src/shared/careerStore';
import { newCareer } from '../src/shared/engine/career/engine';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

const GUARD_KEYS = ['jumpShot', 'finishing', 'passing', 'handles', 'perimeterDefense', 'speed', 'bounce', 'size', 'basketballIQ', 'clutch'];

function career(seed: string) {
  return newCareer({
    seed,
    pos: 'guard',
    name: `Test ${seed}`,
    build: Object.fromEntries(GUARD_KEYS.map((key) => [key, { val: 6 }])),
    games: 'off',
  });
}

describe('career storage', () => {
  it('starts with five empty slots and round-trips a save', () => {
    const storage = memoryStorage();
    expect(readSlots(storage).length).toBe(CAREER_SLOTS);
    expect(readSlots(storage).every((slot) => slot === null)).toBe(true);

    const saved = career('slot-a');
    writeSlot(2, saved, storage);
    const slots = readSlots(storage);
    expect(slots[2]?.seed).toBe('slot-a');
    expect(slots[0]).toBeNull();
    const summary = summarize(2, slots[2] ?? null);
    expect(summary?.name).toBe('Test slot-a');
    expect(summary?.phase).toBe('draft');
  });

  it('drops an unreadable save instead of crashing', () => {
    const storage = memoryStorage();
    storage.setItem(CAREER_KEY, '{not json');
    expect(readSlots(storage).every((slot) => slot === null)).toBe(true);
    storage.setItem(CAREER_KEY, JSON.stringify({ v: 1, slots: [{ seed: 1 }] }));
    expect(readSlots(storage).every((slot) => slot === null)).toBe(true);
  });

  it('clears a slot', () => {
    const storage = memoryStorage();
    writeSlot(0, career('slot-b'), storage);
    clearSlot(0, storage);
    expect(readSlots(storage)[0]).toBeNull();
  });

  it('keeps the last twenty finished careers', () => {
    const storage = memoryStorage();
    for (let index = 0; index < HISTORY_LIMIT + 5; index++) {
      const entry: HistoryEntry = {
        name: `Career ${index}`,
        pos: 'guard',
        seasons: index,
        rings: 0,
        awards: 0,
        ovr: 80,
        legacy: index,
        hof: false,
        at: index,
        seed: `seed-${index}`,
      };
      pushHistory(entry, storage);
    }
    const list = readHistory(storage);
    expect(list.length).toBe(HISTORY_LIMIT);
    expect(list[0]?.name).toBe('Career 24');
    expect(storage.getItem(CAREER_HISTORY_KEY)).toContain('Career 24');
  });

  it('summarises a retired career for the history list', () => {
    const retired = { ...career('slot-c'), phase: 'retired' as const, age: 34 };
    const entry = historyEntry(retired);
    expect(entry.name).toBe('Test slot-c');
    expect(entry.seasons).toBe(0);
    expect(entry.seed).toBe('slot-c');
  });
});
