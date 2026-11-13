import * as v from 'valibot';
import { RunSchema } from '../../shared/data/schemas';
import type { RunState } from '../../shared/run';

const KEY = 'bab:mp:draft:v1';

export function readLocalDraft(code: string): RunState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: unknown; code?: unknown; run?: unknown };
    if (parsed?.v !== 1 || parsed.code !== code) return null;
    const run = v.safeParse(RunSchema, parsed.run);
    return run.success ? (run.output as RunState) : null;
  } catch {
    return null;
  }
}

export function saveLocalDraft(code: string, run: RunState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, code, run }));
  } catch {
    return;
  }
}

export function clearLocalDraft(code: string): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { code?: unknown };
    if (parsed?.code === code) localStorage.removeItem(KEY);
  } catch {
    return;
  }
}
