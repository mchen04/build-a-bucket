import { randomUUID } from 'node:crypto';
import { db } from '../src/server/db';
import { generateCode } from '../src/shared/mp/codes';

export interface FixtureEntry {
  id: string;
  code: string;
  participants: { id: string }[];
}

export function ownedEntry<T extends FixtureEntry>(source: T): T {
  return {
    ...source,
    id: `${source.id}-test-${randomUUID()}`,
    code: generateCode(),
    participants: source.participants.map((participant) => ({ ...participant, id: randomUUID() })),
  };
}

export async function deleteOwned(codes: string[]): Promise<void> {
  if (!codes.length) return;
  await db().query('delete from lobbies where code = any($1::text[])', [codes]);
}
