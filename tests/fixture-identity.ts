import { randomUUID } from 'node:crypto';
import { db } from '../src/server/db';
import { generateCode } from '../src/shared/mp/codes';

export interface FixtureEntry {
  id: string;
  code: string;
  participants: { id: string }[];
}

export interface Owned {
  serverCodes: string[];
  participantIds: string[];
}

export function newOwned(): Owned {
  return { serverCodes: [], participantIds: [] };
}

export function ownedEntry<T extends FixtureEntry>(owned: Owned, source: T): T {
  const participants = source.participants.map((participant) => ({ ...participant, id: randomUUID() }));
  owned.participantIds.push(...participants.map((participant) => participant.id));
  return { ...source, id: `${source.id}-test-${randomUUID()}`, code: generateCode(), participants };
}

export async function deleteOwned(owned: Owned): Promise<void> {
  if (!owned.serverCodes.length && !owned.participantIds.length) return;
  await db().query('delete from lobbies where code = any($1::text[]) or id in (select lobby_id from participants where id = any($2::uuid[]))', [owned.serverCodes, owned.participantIds]);
}
