import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { dbSuite } from './local-db-gate';
import { deleteOwned, newOwned, ownedEntry } from './fixture-identity';
import { db } from '../src/server/db';
import { readyAction as readyHandler } from '../src/server/actions';
import { applyLeagueFixture } from '../.claude/skills/verify-build-a-bucket/scripts/league-fixture.mjs';
import { createRunner } from '../.claude/skills/verify-build-a-bucket/scripts/meter/local-pg.mjs';
import { generateSecret, newActionId } from '../src/shared/mp/codes';
import type { LeagueResult } from '../src/shared/engine/league';

const BASE = 'http://localhost:4173/api';
const owned = newOwned();

function authed(secret: string, path: string, body: unknown): Request {
  return new Request(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
}

afterAll(() => deleteOwned(owned));

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
      const entry = ownedEntry(owned, catalog.entries.find((candidate: { id: string }) => candidate.id === id));
      const secrets = entry.participants.map(() => generateSecret());
        await applyLeagueFixture({ entry, run, connect, secrets });
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

  it('applies through the default runner and the child exits', async () => {
    const catalog = JSON.parse(readFileSync(path.join(process.cwd(), '.claude/skills/verify-build-a-bucket/fixtures/league-fixtures.json'), 'utf8'));
    const source = catalog.entries.find((candidate: { id: string }) => candidate.id === 'normal-2p-q1');
    const entry = ownedEntry(owned, source);
    const code = entry.code;
    const moduleUrl = new URL('../.claude/skills/verify-build-a-bucket/scripts/league-fixture.mjs', import.meta.url).href;
    const childCode = `import { applyLeagueFixture } from ${JSON.stringify(moduleUrl)}; const args = JSON.parse(process.env.BAB_FIXTURE_ARGS); args.run.pidAlive = () => true; args.run.readFile = () => ['1', '', '', String(args.run.port), args.run.socketDir].join('\\n'); await applyLeagueFixture(args); console.log('applied');`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], { env: { ...process.env, BAB_FIXTURE_ARGS: JSON.stringify({ entry, run, secrets: entry.participants.map(() => generateSecret()) }) } });
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    const exit = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(null); }, 15000);
      child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
    });
    expect(output, errors).toContain('applied');
    expect(exit).toBe(0);
    const rows = await db().query<{ count: string }>('select count(*) from participants p join lobbies l on l.id=p.lobby_id where l.code=$1', [code]);
    expect(Number(rows[0]?.count)).toBe(entry.players);
  }, 30_000);
});
