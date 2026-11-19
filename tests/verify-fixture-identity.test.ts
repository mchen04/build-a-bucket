import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { dbSuite } from './local-db-gate';
import { deleteOwned, newOwned, ownedEntry } from './fixture-identity';
import { db } from '../src/server/db';
import { applyLeagueFixture } from '../.claude/skills/verify-build-a-bucket/scripts/league-fixture.mjs';
import { createRunner } from '../.claude/skills/verify-build-a-bucket/scripts/meter/local-pg.mjs';
import { generateSecret } from '../src/shared/mp/codes';

const sweep = newOwned();
afterAll(() => deleteOwned(sweep));

dbSuite()('fixture test cleanup owns its rows', () => {
  const socketDir = process.env.BAB_PG_SOCKET_DIR ?? '';
  const port = Number(process.env.BAB_PG_PORT ?? 0);
  const database = process.env.BAB_PG_DATABASE ?? '';
  const run = {
    devLocal: true,
    supervisorPid: 1,
    postgresPid: 1,
    socketDir,
    port,
    database,
    socket: path.join(socketDir, `.s.PGSQL.${port}`),
    postmasterPidPath: 'stand-in',
    pidAlive: () => true,
    readFile: () => ['1', '', '', String(port), socketDir].join('\n'),
  };
  const connect = (target: { socketDir: string; port: number; database: string }) => createRunner(target);
  const catalog = JSON.parse(readFileSync(path.join(process.cwd(), '.claude/skills/verify-build-a-bucket/fixtures/league-fixtures.json'), 'utf8'));
  const source = catalog.entries.find((candidate: { id: string }) => candidate.id === 'normal-2p-q1');
  const secrets = () => source.participants.map(() => generateSecret());
  const lobbies = async (code: string) => Number((await db().query<{ count: string }>('select count(*)::text as count from lobbies where code = $1', [code]))[0]?.count);
  const seats = async (code: string) => Number((await db().query<{ count: string }>('select count(*)::text as count from participants p join lobbies l on l.id = p.lobby_id where l.code = $1', [code]))[0]?.count);

  it('a rolled-back same-code fixture cannot delete its peer; a committed one cleans up after close fails', async () => {
    const ownerA = newOwned();
    const a = ownedEntry(ownerA, source);
    sweep.participantIds.push(...ownerA.participantIds);
    await applyLeagueFixture({ entry: a, run, connect, secrets: secrets() });
    expect(await lobbies(a.code)).toBe(1);

    const ownerB = newOwned();
    const b = { ...ownedEntry(ownerB, source), code: a.code };
    sweep.participantIds.push(...ownerB.participantIds);
    await expect(applyLeagueFixture({ entry: b, run, connect, secrets: secrets() })).rejects.toThrow(/lobbies_code_key/);
    await deleteOwned(ownerB);
    expect(await lobbies(a.code)).toBe(1);
    expect(await seats(a.code)).toBe(2);

    const ownerC = newOwned();
    const c = ownedEntry(ownerC, source);
    sweep.participantIds.push(...ownerC.participantIds);
    const failingClose = async (target: { socketDir: string; port: number; database: string }) => {
      const runner = await createRunner(target);
      return { ...runner, transaction: runner.transaction.bind(runner), close: async () => { await runner.close(); throw new Error('close failed'); } };
    };
    await expect(applyLeagueFixture({ entry: c, run, connect: failingClose, secrets: secrets() })).rejects.toThrow(/fixture committed but cleanup failed/);
    expect(await lobbies(c.code)).toBe(1);
    await deleteOwned(ownerC);
    expect(await lobbies(c.code)).toBe(0);
    expect(await lobbies(a.code)).toBe(1);

    await deleteOwned(ownerA);
    expect(await lobbies(a.code)).toBe(0);
  }, 60_000);
});
