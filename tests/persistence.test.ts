import { describe, expect, it } from 'vitest';
import { clearRun, loadRun, saveRun, STORAGE_KEY } from '../src/shared/persistence';
import { createRun, placePick, type RunState } from '../src/shared/run';
import { simulateSeason } from '../src/shared/engine/season';
import { mulberry32 } from '../src/shared/engine/rng';
import type { Player } from '../src/shared/engine/types';
import { GUARD_KEYS, picksFor } from './fixtures/pool';

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

function fullRun(): RunState {
  let run = createRun('b-test-1', 'guard', 'current');
  const picks = picksFor(GUARD_KEYS, { jumpShot: 8, finishing: 7, passing: 9 });
  run = { ...run, picks, screen: 'team', team: 'MIA', spinIndex: 10 };
  return run;
}

describe('run persistence', () => {
  it('reports an empty store', () => {
    expect(loadRun(new MemoryStorage())).toEqual({ status: 'empty' });
  });

  it('round-trips a run through storage', () => {
    const storage = new MemoryStorage();
    const run = fullRun();
    expect(saveRun(run, storage)).toBe(true);
    const outcome = loadRun(storage);
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.run).toEqual(run);
  });

  it('round-trips a finished run with a season result', () => {
    const storage = new MemoryStorage();
    const run = fullRun();
    const season = simulateSeason({
      build: { position: run.position, era: run.era, picks: run.picks },
      team: run.team ?? 'MIA',
      playerName: 'You',
      rng: mulberry32(7),
      displayRng: mulberry32(8),
    });
    const finished: RunState = { ...run, season, screen: 'end' };
    expect(saveRun(finished, storage)).toBe(true);
    const outcome = loadRun(storage);
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.run.season?.wins).toBe(season.wins);
      expect(outcome.run.season?.games).toHaveLength(82);
      expect(outcome.run.screen).toBe('end');
    }
  });

  it('rejects corrupt JSON', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, '{not json');
    expect(loadRun(storage)).toEqual({ status: 'corrupt' });
  });

  it('rejects a snapshot from another version', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...fullRun(), v: 2 }));
    expect(loadRun(storage)).toEqual({ status: 'corrupt' });
  });

  it('rejects a snapshot with the wrong shape', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, seed: 'x', position: 'wing' }));
    expect(loadRun(storage)).toEqual({ status: 'corrupt' });
  });

  it('rejects a run with a bad screen name', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...fullRun(), screen: 'lobby' }));
    expect(loadRun(storage)).toEqual({ status: 'corrupt' });
  });

  it('clears a stored run', () => {
    const storage = new MemoryStorage();
    saveRun(fullRun(), storage);
    clearRun(storage);
    expect(loadRun(storage)).toEqual({ status: 'empty' });
  });
});

describe('run state', () => {
  it('fills one slot per pick and advances the spin index', () => {
    const run = createRun('b-test-2', 'guard', 'current');
    const player: Player = {
      name: 'Test Player',
      short: 'Test',
      team: 'MIA',
      number: 3,
      attrs: { jumpShot: 9 },
    };
    const next = placePick(run, player, 'jumpShot');
    expect(Object.keys(next.picks)).toEqual(['jumpShot']);
    expect(next.picks.jumpShot).toEqual({
      attr: 'jumpShot',
      val: 9,
      playerName: 'Test Player',
      playerShort: 'Test',
      team: 'MIA',
      number: 3,
    });
    expect(next.spinIndex).toBe(1);
    expect(next.current).toBeNull();
  });
});
