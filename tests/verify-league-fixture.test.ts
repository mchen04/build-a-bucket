import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applyLeagueFixture, classifyFixture, defaultConnect, fixtureAppOrigin, fixtureOptions, fixtureRunFrom, fixtureStorageState, fixtureVerdict, guardOwnedRun, openFixtureRun } from '../.claude/skills/verify-build-a-bucket/scripts/league-fixture.mjs';
import { awaitReloadProof, refreshCoverage } from '../.claude/skills/verify-build-a-bucket/scripts/standings-check.mjs';
import type { FixtureRunner, FixtureTarget } from '../.claude/skills/verify-build-a-bucket/scripts/league-fixture.mjs';
import { createRunner } from '../.claude/skills/verify-build-a-bucket/scripts/meter/local-pg.mjs';
import { hashSecret } from '../src/shared/mp/codes.js';

const catalog = JSON.parse(readFileSync(path.join(process.cwd(), '.claude/skills/verify-build-a-bucket/fixtures/league-fixtures.json'), 'utf8'));
const entry = catalog.entries[0];
const secrets = entry.participants.map((_: unknown, index: number) => `secret-${index + 1}`);
const validRun = {
  devLocal: true,
  neon: false,
  prod: false,
  supervisorPid: 100,
  postgresPid: 200,
  postmasterPidPath: '/owned/data/postmaster.pid',
  socket: '/owned/socket/.s.PGSQL.55434',
  socketDir: '/owned/socket',
  port: 55434,
  database: 'bab',
  readFile: () => '200\n/owned/data\n1234567890\n55434\n/owned/socket\n',
  pidAlive: (pid: number) => pid === 100 || pid === 200,
};

function connectStub(options: { failOn?: string } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const targets: FixtureTarget[] = [];
  let closed = false;
  const connect = async (target: FixtureTarget): Promise<FixtureRunner> => {
    targets.push(target);
    return {
      transaction: async (queries: { text: string; params?: unknown[] }[]) => {
        calls.push({ sql: 'BEGIN', params: [] });
        try {
          for (const query of queries) {
            calls.push({ sql: query.text, params: query.params ?? [] });
            if (options.failOn && query.text.startsWith(options.failOn)) throw new Error('insert failed');
          }
          calls.push({ sql: 'COMMIT', params: [] });
          return [];
        } catch (error) {
          calls.push({ sql: 'ROLLBACK', params: [] });
          throw error;
        }
      },
      close: async () => {
        closed = true;
      },
    };
  };
  return { calls, targets, connect, isClosed: () => closed };
}

describe('league fixture guard', () => {
  it('refuses a base url', () => {
    expect(() => guardOwnedRun({ run: validRun, base: 'http://localhost:3000' })).toThrow();
  });

  it('refuses a neon run', () => {
    expect(() => guardOwnedRun({ run: { ...validRun, neon: true } })).toThrow();
  });

  it('refuses a prod run', () => {
    expect(() => guardOwnedRun({ run: { ...validRun, prod: true } })).toThrow();
  });

  it('refuses a missing current run', () => {
    expect(() => guardOwnedRun({ run: null })).toThrow();
  });

  it('refuses a dead supervisor', () => {
    expect(() => guardOwnedRun({ run: { ...validRun, supervisorPid: 999 } })).toThrow();
  });

  it('refuses a dead postgres', () => {
    expect(() => guardOwnedRun({ run: { ...validRun, postgresPid: 999 } })).toThrow();
  });

  it('refuses a pid mismatch', () => {
    expect(() => guardOwnedRun({ run: { ...validRun, readFile: () => '999\n' } })).toThrow();
  });

  it('refuses a socket outside the owned dir', () => {
    expect(() => guardOwnedRun({ run: { ...validRun, socket: '/other/.s.PGSQL.55434' } })).toThrow();
  });

  it('returns the owned target', () => {
    expect(guardOwnedRun({ run: validRun, readFile: validRun.readFile, pidAlive: validRun.pidAlive })).toEqual({ socketDir: '/owned/socket', port: 55434, database: 'bab' });
  });
});

describe('league fixture guard binds the target', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['wrong port', { port: 55435 }],
    ['socket naming a different port', { socket: '/owned/socket/.s.PGSQL.55435' }],
    ['postmaster port mismatch', { readFile: () => '200\n/owned/data\n1234567890\n55435\n/owned/socket\n' }],
    ['postmaster socket-dir mismatch', { readFile: () => '200\n/owned/data\n1234567890\n55434\n/other/socket\n' }],
    ['relative socketDir', { socketDir: 'owned/socket' }],
    ['empty database', { database: '' }],
    ['missing database', { database: undefined }],
    ['NaN port', { port: Number.NaN }],
    ['missing port', { port: undefined }],
  ];
  for (const [name, patch] of cases) {
    it(`refuses ${name} before connect`, async () => {
      const { targets, connect } = connectStub();
      await expect(applyLeagueFixture({ entry, run: { ...validRun, ...patch }, connect, secrets })).rejects.toThrow();
      expect(targets).toHaveLength(0);
    });
  }

  it('connects with exactly the validated target', async () => {
    const { targets, connect } = connectStub();
    await applyLeagueFixture({ entry, run: validRun, connect, secrets });
    expect(targets).toEqual([{ socketDir: '/owned/socket', port: 55434, database: 'bab' }]);
  });

  it('refuses a run carrying base with zero connects', async () => {
    const { calls, targets, connect } = connectStub();
    await expect(applyLeagueFixture({ entry, run: { ...validRun, base: 'http://localhost:3000' }, connect, secrets })).rejects.toThrow();
    expect(calls).toHaveLength(0);
    expect(targets).toHaveLength(0);
  });
});

describe('fixture run from state', () => {
  const state = { mode: 'dev', localDb: { database: 'bab', pgPort: 55434 }, supervisor: { pid: 100 } };
  const init = { state: 'initialized', database: 'bab', dataDir: '/owned/data', sockDir: '/owned/socket' };
  const supervisor = { pid: 100, services: [], postgres: { pid: 200, port: 55434, database: 'bab', dataDir: '/owned/data', sockDir: '/owned/socket' } };

  it('maps the run record', () => {
    expect(fixtureRunFrom({ state, init, supervisor })).toEqual({
      devLocal: true,
      neon: false,
      prod: false,
      supervisorPid: 100,
      postgresPid: 200,
      socketDir: '/owned/socket',
      port: 55434,
      database: 'bab',
      socket: '/owned/socket/.s.PGSQL.55434',
      postmasterPidPath: '/owned/data/postmaster.pid',
    });
  });

  it('refuses a foreign supervisor pid', () => {
    expect(() => fixtureRunFrom({ state, init, supervisor: { ...supervisor, pid: 101 } })).toThrow();
  });

  it('refuses a database mismatch', () => {
    expect(() => fixtureRunFrom({ state, init: { ...init, database: 'other' }, supervisor })).toThrow();
  });

  it('yields a neon run the guard refuses', () => {
    expect(() => fixtureRunFrom({ state: { ...state, localDb: null }, init, supervisor })).toThrow('supervisor postgres does not match the run');
  });

  it('yields a prod run the guard refuses', () => {
    const run = fixtureRunFrom({ state: { ...state, mode: 'prod' }, init, supervisor });
    expect(run.prod).toBe(true);
    expect(() => guardOwnedRun({ run, readFile: () => '', pidAlive: () => true })).toThrow();
  });
});

describe('fixture options', () => {
  it('accepts the entry options', () => {
    expect(fixtureOptions(entry)).toEqual({ players: entry.players, mode: entry.mode, era: entry.era });
  });

  it('refuses a players mismatch', () => {
    expect(() => fixtureOptions(entry, { players: entry.players + 1 })).toThrow();
  });

  it('refuses a mode mismatch', () => {
    expect(() => fixtureOptions(entry, { mode: entry.mode === 'normal' ? 'squad' : 'normal' })).toThrow();
  });

  it('refuses an era mismatch', () => {
    expect(() => fixtureOptions(entry, { era: entry.era === 'current' ? 'alltime' : 'current' })).toThrow();
  });

  it('refuses an invalid expectedClass', () => {
    expect(() => fixtureOptions({ ...entry, expectedClass: 'other' })).toThrow();
  });

  it('refuses an expectedClass that disagrees with qualifyingSeats', () => {
    expect(() => fixtureOptions({ ...entry, expectedClass: entry.qualifyingSeats.length > 0 ? 'all-eliminated' : 'qualifying' })).toThrow();
  });
});

describe('fixture verdict', () => {
  it('returns no error on a match', () => {
    expect(fixtureVerdict({ entry, classified: { observedClass: entry.expectedClass, qualifyingSeats: entry.qualifyingSeats } })).toEqual({ record: { id: entry.id, expectedClass: entry.expectedClass, observedClass: entry.expectedClass, qualifyingSeats: entry.qualifyingSeats }, error: null });
  });

  it('returns an error on a wrong class', () => {
    const verdict = fixtureVerdict({ entry, classified: { observedClass: entry.expectedClass === 'qualifying' ? 'all-eliminated' : 'qualifying', qualifyingSeats: entry.qualifyingSeats } });
    expect(verdict.error).toBeTruthy();
    expect(verdict.record.observedClass).not.toBe(entry.expectedClass);
  });

  it('returns an error on wrong seats', () => {
    const verdict = fixtureVerdict({ entry, classified: { observedClass: entry.expectedClass, qualifyingSeats: [...entry.qualifyingSeats, 99] } });
    expect(verdict.error).toBeTruthy();
  });

  it('returns an error on unknown', () => {
    const verdict = fixtureVerdict({ entry, classified: { observedClass: 'unknown', qualifyingSeats: [] } });
    expect(verdict.error).toBeTruthy();
    expect(verdict.record.observedClass).toBe('unknown');
  });
});

describe('fixture class', () => {
  it('classifies a gate as qualifying', () => {
    expect(classifyFixture({ gateSeen: true, gateReadySeats: [1], allEliminated: false, recap: false })).toEqual({ observedClass: 'qualifying', qualifyingSeats: [1] });
  });

  it('classifies no gate and all eliminated by recap', () => {
    expect(classifyFixture({ gateSeen: false, gateReadySeats: [], allEliminated: true, recap: true })).toEqual({ observedClass: 'all-eliminated', qualifyingSeats: [] });
  });

  it('classifies no gate before recap as unknown', () => {
    expect(classifyFixture({ gateSeen: false, gateReadySeats: [], allEliminated: true, recap: false })).toEqual({ observedClass: 'unknown', qualifyingSeats: [] });
  });

  it('rejects all-eliminated without the signature', () => {
    expect(classifyFixture({ gateSeen: false, gateReadySeats: [], allEliminated: false, recap: true })).toEqual({ observedClass: 'unknown', qualifyingSeats: [] });
  });

  it('rejects all-eliminated when the gate was seen', () => {
    expect(classifyFixture({ gateSeen: true, gateReadySeats: [1], allEliminated: true, recap: true })).toEqual({ observedClass: 'qualifying', qualifyingSeats: [1] });
  });

  it('accepts all-eliminated only with the signature', () => {
    expect(classifyFixture({ gateSeen: false, gateReadySeats: [], allEliminated: true, recap: true })).toEqual({ observedClass: 'all-eliminated', qualifyingSeats: [] });
  });
});

describe('fixture storage state', () => {
  it('seeds one owned origin with the session', () => {
    const state = fixtureStorageState({ base: 'http://127.0.0.1:4173', code: 'ABC123', secret: 's', name: 'Ava' });
    expect(state.origins).toHaveLength(1);
    expect(state.origins[0]!.origin).toBe('http://127.0.0.1:4173');
    expect(state.origins[0]!.localStorage).toEqual([{ name: 'bab:mp:v1', value: JSON.stringify({ v: 1, code: 'ABC123', secret: 's', name: 'Ava' }) }]);
  });

  it('refuses https', () => {
    expect(() => fixtureStorageState({ base: 'https://127.0.0.1:4173', code: 'ABC123', secret: 's', name: 'Ava' })).toThrow();
  });

  it('refuses a foreign host', () => {
    expect(() => fixtureStorageState({ base: 'http://example.com', code: 'ABC123', secret: 's', name: 'Ava' })).toThrow();
  });

  it('refuses a non-URL', () => {
    expect(() => fixtureStorageState({ base: 'not a url', code: 'ABC123', secret: 's', name: 'Ava' })).toThrow();
  });
});

describe('fixture session persistence', () => {
  const read = (seat: number, name: string) => ({ seat: { seat, name }, revision: { stage: 'Playoffs', progress: 'First Round' }, tables: [['1 A 1-0'], ['1 B 1-0']] });
  const readAll = async () => [read(1, 'Ava'), read(2, 'Ben')];
  const proof = (session: { present: boolean }) => awaitReloadProof({ session, readAll, isRecap: async () => false, refreshedSeat: { seat: 2, name: 'Ben' }, wait: async () => {}, attempts: 1 });

  it('clears the session and fails the next document', async () => {
    const storage = new Map<string, string>();
    const initScripts: (() => void)[] = [];
    const state = fixtureStorageState({ base: 'http://127.0.0.1:4173', code: 'ABC123', secret: 's', name: 'Ava' });
    for (const entry of state.origins[0]!.localStorage) storage.set(entry.name, entry.value);
    const document = () => { for (const script of initScripts) script(); };
    document();
    storage.clear();
    document();
    const session = { present: storage.has('bab:mp:v1') };
    expect(session.present).toBe(false);
    const result = await proof(session);
    expect(result.classification).toBe('invalid-display');
    expect(result.classification).not.toBe('stable-match');
  });

  it('keeps the session without a clear', async () => {
    const storage = new Map<string, string>();
    const state = fixtureStorageState({ base: 'http://127.0.0.1:4173', code: 'ABC123', secret: 's', name: 'Ava' });
    for (const entry of state.origins[0]!.localStorage) storage.set(entry.name, entry.value);
    const session = { present: storage.has('bab:mp:v1') };
    expect(session.present).toBe(true);
    const result = await proof(session);
    expect(result.classification).toBe('stable-match');
  });

  it('the old init script restores the session', () => {
    const storage = new Map<string, string>();
    const initScripts = [() => storage.set('bab:mp:v1', JSON.stringify({ v: 1, code: 'ABC123', secret: 's', name: 'Ava' }))];
    storage.clear();
    for (const script of initScripts) script();
    expect(storage.has('bab:mp:v1')).toBe(true);
  });

  it('keeps bab:mp:v1 out of init scripts', () => {
    const source = readFileSync(path.join(process.cwd(), '.claude/skills/verify-build-a-bucket/scripts/control.mjs'), 'utf8');
    const initCalls = [...source.matchAll(/addInitScript\(([\s\S]*?)\)/g)].map((match) => match[1]);
    expect(initCalls.some((text) => text?.includes('bab:mp:v1'))).toBe(false);
    expect(source.split('bab:mp:v1').length - 1).toBe(1);
  });

  it('gates the reload waits on shouldAwaitStandings', () => {
    const source = readFileSync(path.join(process.cwd(), '.claude/skills/verify-build-a-bucket/scripts/control.mjs'), 'utf8');
    const gate = source.indexOf('shouldAwaitStandings(');
    const wait = source.indexOf('waitStage(seat)', gate);
    expect(gate).toBeGreaterThan(-1);
    expect(wait).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(wait);
  });

  it('fails refresh coverage without a persisted session', () => {
    const value = { classification: 'stable-match', ran: true, revision: { stage: 'Season', progress: '1 / 10' }, seats: ['1:Ava', '2:Ben'], rowsCompared: 20, refreshedSeat: { seat: 2, name: 'Ben' }, navigation: { observed: true }, attempts: 'reload-attempts.json', session: { present: false } };
    expect(refreshCoverage(true, value).ok).toBe(false);
    expect(refreshCoverage(true, value).reason).toBe('session not persisted after reload');
  });
});

describe('fixture app origin', () => {
  const state = { mode: 'dev', base: 'http://127.0.0.1:4173/', port: 4173 };
  const spec = { services: [{ kind: 'app', args: ['--port', '4173', '--strictPort'] }] };

  it('returns the owned origin', () => {
    expect(fixtureAppOrigin({ state, spec })).toBe('http://127.0.0.1:4173');
  });

  it('refuses a foreign recorded base', () => {
    expect(() => fixtureAppOrigin({ state: { ...state, base: 'http://example.com:4173/' }, spec })).toThrow();
  });

  it('refuses https', () => {
    expect(() => fixtureAppOrigin({ state: { ...state, base: 'https://127.0.0.1:4173/' }, spec })).toThrow();
  });

  it('refuses a recorded base port mismatch', () => {
    expect(() => fixtureAppOrigin({ state: { ...state, base: 'http://127.0.0.1:4174/' }, spec })).toThrow();
  });

  it('refuses a spec app port mismatch', () => {
    expect(() => fixtureAppOrigin({ state, spec: { services: [{ kind: 'app', args: ['--port', '4174', '--strictPort'] }] } })).toThrow();
  });

  it('refuses no app service', () => {
    expect(() => fixtureAppOrigin({ state, spec: { services: [] } })).toThrow();
  });

  it('refuses a missing strictPort', () => {
    expect(() => fixtureAppOrigin({ state, spec: { services: [{ kind: 'app', args: ['--port', '4173'] }] } })).toThrow();
  });

  it('refuses a prod run', () => {
    expect(() => fixtureAppOrigin({ state: { ...state, mode: 'prod' }, spec })).toThrow();
  });
});

describe('open fixture run', () => {
  const state = { mode: 'dev', base: 'http://127.0.0.1:4173/', port: 4173, localDb: { database: 'bab', pgPort: 55434 }, supervisor: { pid: 100 } };
  const init = { state: 'initialized', database: 'bab', dataDir: '/owned/data', sockDir: '/owned/socket' };
  const supervisor = { pid: 100, services: [], postgres: { pid: 200, port: 55434, database: 'bab', dataDir: '/owned/data', sockDir: '/owned/socket' } };
  const spec = { services: [{ kind: 'app', args: ['--port', '4173', '--strictPort'] }] };
  const files: Record<string, unknown> = { 'run.json': state, 'supervisor-init.json': init, 'supervisor.json': supervisor, 'supervisor-spec.json': spec };
  const readJson = (file: string) => files[path.basename(file)];
  const fixture = { id: 'fx', mode: 'normal', era: 'current', players: 1, code: 'ABC123', secret: 's', expectedClass: 'qualifying' as const, qualifyingSeats: [1], participants: [{ id: 'p1', seat: 1, name: 'Ava', team: 'ATL', build: { kind: 'normal' }, summary: {} }] };

  it('applies then launches and returns the origin', async () => {
    const calls: string[] = [];
    const apply = async () => { calls.push('apply'); };
    const launch = async () => { calls.push('launch'); return { browser: true }; };
    const result = await openFixtureRun({ base: undefined, dir: '/run', fixture, readJson, apply, launch, makeSecret: () => 's' });
    expect(calls).toEqual(['apply', 'launch']);
    expect(result.origin).toBe('http://127.0.0.1:4173');
    expect(result.secrets).toEqual(['s']);
  });

  it('refuses an explicit base with zero apply and launch', async () => {
    const calls: string[] = [];
    const apply = async () => { calls.push('apply'); };
    const launch = async () => { calls.push('launch'); return {}; };
    await expect(openFixtureRun({ base: 'http://127.0.0.1:4173', dir: '/run', fixture, readJson, apply, launch, makeSecret: () => 's' })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it.each([
    ['foreign base', { ...state, base: 'http://example.com:4173/' }, spec],
    ['https', { ...state, base: 'https://127.0.0.1:4173/' }, spec],
    ['base port', { ...state, base: 'http://127.0.0.1:4174/' }, spec],
    ['spec port', state, { services: [{ kind: 'app', args: ['--port', '4174', '--strictPort'] }] }],
    ['no app', state, { services: [] }],
    ['no strictPort', state, { services: [{ kind: 'app', args: ['--port', '4173'] }] }],
    ['prod', { ...state, mode: 'prod' }, spec],
  ])('refuses %s with zero calls', async (_name, badState, badSpec) => {
    const calls: string[] = [];
    const apply = async () => { calls.push('apply'); };
    const launch = async () => { calls.push('launch'); return {}; };
    const makeSecret = () => { calls.push('makeSecret'); return 's'; };
    const badFiles: Record<string, unknown> = { ...files, 'run.json': badState, 'supervisor-spec.json': badSpec };
    const badReadJson = (file: string) => badFiles[path.basename(file)];
    await expect(openFixtureRun({ base: undefined, dir: '/run', fixture, readJson: badReadJson, apply, launch, makeSecret })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe('fixture launch source', () => {
  it('launches the fixture browser only through openFixtureRun', () => {
    const source = readFileSync(path.join(process.cwd(), '.claude/skills/verify-build-a-bucket/scripts/control.mjs'), 'utf8');
    const open = source.indexOf('openFixtureRun(');
    const launch = source.indexOf('pw[browserName].launch(', open);
    expect(open).toBeGreaterThan(-1);
    expect(launch).toBeGreaterThan(-1);
    expect(launch).toBeGreaterThan(open);
  });
});

describe('league fixture writer', () => {
  it('issues zero SQL for each refusal', async () => {
    const refusals = [
      { ...validRun, base: 'http://localhost:3000' },
      { ...validRun, neon: true },
      { ...validRun, prod: true },
      null,
      { ...validRun, supervisorPid: 999 },
      { ...validRun, postgresPid: 999 },
      { ...validRun, readFile: () => '999\n' },
      { ...validRun, socket: '/other/.s.PGSQL.55434' },
    ];
    for (const run of refusals) {
      const { calls, targets, connect } = connectStub();
      await expect(applyLeagueFixture({ entry, run, connect, secrets })).rejects.toThrow();
      expect(calls).toHaveLength(0);
      expect(targets).toHaveLength(0);
    }
  });

  it('connects only to the guarded target and writes one transaction', async () => {
    const { calls, targets, connect, isClosed } = connectStub();
    const result = await applyLeagueFixture({ entry, run: validRun, connect, secrets });
    expect(targets).toEqual([{ socketDir: '/owned/socket', port: 55434, database: 'bab' }]);
    expect(result.lobbyId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(result.code).toBe(entry.code);
    expect(result.participantIds).toEqual(entry.participants.map((participant: { id: string }) => participant.id));
    expect(result.target).toEqual({ socketDir: '/owned/socket', port: 55434, database: 'bab' });
    expect(calls.filter((call) => call.sql === 'BEGIN')).toHaveLength(1);
    expect(calls.filter((call) => call.sql === 'COMMIT')).toHaveLength(1);
    expect(calls.filter((call) => call.sql.startsWith('insert into lobbies'))).toHaveLength(1);
    expect(calls.filter((call) => call.sql.startsWith('insert into participants'))).toHaveLength(entry.players);
    expect(calls.filter((call) => call.sql.startsWith('insert into lobby_teams'))).toHaveLength(entry.players);
    expect(isClosed()).toBe(true);
    const lobbyCall = calls.find((call) => call.sql.startsWith('insert into lobbies'));
    expect(lobbyCall?.params[0]).toBe(result.lobbyId);
    expect(lobbyCall?.params[1]).toBe(entry.code);
    expect(lobbyCall?.params[2]).toBe('preview');
    expect(lobbyCall?.params[7]).toBe(entry.secret);
    expect(lobbyCall?.params[8]).toBe(entry.participants[0].id);
    const participantCalls = calls.filter((call) => call.sql.startsWith('insert into participants'));
    for (const [index, call] of participantCalls.entries()) {
      expect(call.params[1]).toBe(result.lobbyId);
      expect(call.params[2]).toBe(await hashSecret(secrets[index]));
      expect(call.params[6]).toBe(JSON.stringify(entry.participants[index].build));
      expect(call.params[7]).toBe(entry.participants[index].build.kind);
      expect(call.params[8]).toBe(JSON.stringify(entry.participants[index].summary));
    }
  });

  it('rolls back and rethrows after a failed insert', async () => {
    const { calls, connect, isClosed } = connectStub({ failOn: 'insert into participants' });
    await expect(applyLeagueFixture({ entry, run: validRun, connect, secrets })).rejects.toThrow('insert failed');
    expect(calls.map((call) => (call.sql.startsWith('insert into lobbies') ? 'insert into lobbies' : call.sql.startsWith('insert into participants') ? 'insert into participants' : call.sql))).toEqual(['BEGIN', 'insert into lobbies', 'insert into participants', 'ROLLBACK']);
    expect(calls.some((call) => call.sql === 'COMMIT')).toBe(false);
    expect(isClosed()).toBe(true);
  });

  it('keeps secrets out of the result and logs', async () => {
    const { connect } = connectStub();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '));
    });
    const result = await applyLeagueFixture({ entry, run: validRun, connect, secrets });
    spy.mockRestore();
    const text = JSON.stringify(result) + logs.join('\n');
    for (const secret of secrets) expect(text).not.toContain(secret);
  });
});

describe('owned runner target', () => {
  it('uses an explicit target after a no-arg runner', async () => {
    const noArg = await createRunner();
    const explicit = await createRunner({ socketDir: '/owned/socket', port: 55434, database: 'bab' });
    expect(explicit.target).toEqual({ socketDir: '/owned/socket', port: 55434, database: 'bab' });
    expect(noArg.target).toEqual({ socketDir: process.env.BAB_PG_SOCKET_DIR ?? '', port: Number(process.env.BAB_PG_PORT ?? 55432), database: process.env.BAB_PG_DATABASE ?? 'bab_perf' });
  });

  it('defaultConnect leaves process.env unchanged', async () => {
    const before = { ...process.env };
    const runner = await defaultConnect({ socketDir: '/owned/socket', port: 55434, database: 'bab' });
    expect(process.env).toEqual(before);
    expect(runner.target).toEqual({ socketDir: '/owned/socket', port: 55434, database: 'bab' });
  });
});
