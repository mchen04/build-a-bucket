import * as v from 'valibot';
import { RunSchema } from './data/schemas';
import type { RunState } from './run';

export const STORAGE_KEY = 'bab:v1';

export type LoadOutcome =
  | { status: 'empty' }
  | { status: 'ok'; run: RunState }
  | { status: 'corrupt' };

export function loadRun(storage: Storage = localStorage): LoadOutcome {
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { status: 'corrupt' };
  }
  if (!raw) return { status: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'corrupt' };
  }
  const result = v.safeParse(RunSchema, parsed);
  if (!result.success) return { status: 'corrupt' };
  return { status: 'ok', run: result.output as unknown as RunState };
}

export function saveRun(run: RunState, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(run));
    return true;
  } catch {
    return false;
  }
}

export function clearRun(storage: Storage = localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}
