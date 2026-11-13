import * as v from 'valibot';
import type { RunState } from './run';
import { RunSchema } from './data/schemas';

export const SQUAD_KEY = 'bab:squad:v1';

export type SquadStage = 'build' | 'review' | 'season' | 'standings' | 'playoffs' | 'recap';

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

const SquadSchema = v.object({
  v: v.literal(1),
  seed: v.string(),
  team: v.nullable(v.string()),
  season: v.number(),
  stage: v.optional(v.picklist(['build', 'review', 'season', 'standings', 'playoffs', 'recap'])),
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
  stage?: SquadStage;
  slots: SquadSlotState[];
  result: unknown;
}

export function newSquadState(seed: string): SquadState {
  return {
    v: 1,
    seed,
    team: null,
    season: 0,
    stage: 'build',
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
