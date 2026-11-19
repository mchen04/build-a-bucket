import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { dbSuite } from './local-db-gate';
import { db } from '../src/server/db';
import { readyAction as readyHandler } from '../src/server/actions';
import { applyLeagueFixture } from '../.claude/skills/verify-build-a-bucket/scripts/league-fixture.mjs';
import { createRunner } from '../.claude/skills/verify-build-a-bucket/scripts/meter/local-pg.mjs';
import { generateSecret, newActionId } from '../src/shared/mp/codes';
import type { LeagueResult } from '../src/shared/engine/league';

const BASE = 'http://localhost:4173/api';
const created: string[] = [];

function authed(secret: string, path: string, body: unknown): Request {
  return new Request(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
}

afterAll(async () => {
  if (!created.length) return;
  await db().query('delete from lobbies where code = any($1::text[])', [created]);
});

dbSuite()('league fixtures on the real server', () => {
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
  for (const id of ['normal-2p-q1', 'squad-4p-elim']) {
    it(`gives ${id} its declared class`, async () => {
      const catalog = JSON.parse(readFileSync(path.join(process.cwd(), '.claude/skills/verify-build-a-bucket/fixtures/league-fixtures.json'), 'utf8'));
      const entry = catalog.entries.find((candidate: { id: string }) => candidate.id === id);
      const secrets = entry.participants.map(() => generateSecret());
      await applyLeagueFixture({ entry, run, connect, secrets });
      created.push(entry.code);
      for (let index = 0; index < entry.participants.length; index++) {
        const response = await readyHandler(authed(secrets[index], `lobby/${entry.code}/ready`, { actionId: newActionId(), stage: 0 }));
        expect(response.status).toBe(200);
      }
      const rows = await db().query<{ phase: string; league: unknown }>('select phase, league from lobbies where code = $1', [entry.code]);
      expect(rows[0]?.phase).toBe('season');
      const league = rows[0]?.league as LeagueResult;
      expect(league.humans.filter((human) => human.madePlayoffs).map((human) => human.seat)).toEqual(entry.qualifyingSeats);
    }, 120_000);
  }
});
