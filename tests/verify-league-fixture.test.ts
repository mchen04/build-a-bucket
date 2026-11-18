import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applyLeagueFixture, guardOwnedRun } from '../.claude/skills/verify-build-a-bucket/scripts/league-fixture.mjs';
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
  readFile: () => '200\n/owned/data\n',
  pidAlive: (pid: number) => pid === 100 || pid === 200,
};

function runnerStub() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const runner = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.startsWith('insert into lobbies')) return [{ id: 'lobby-uuid' }];
    return [];
  };
  return { calls, runner };
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
      const { calls, runner } = runnerStub();
      await expect(applyLeagueFixture({ entry, run, runner, secrets })).rejects.toThrow();
      expect(calls).toHaveLength(0);
    }
  });

  it('writes one transaction on the owned target', async () => {
    const { calls, runner } = runnerStub();
    const result = await applyLeagueFixture({ entry, run: validRun, runner, secrets });
    expect(result.lobbyId).toBe('lobby-uuid');
    expect(result.code).toBe(entry.code);
    expect(result.participantIds).toEqual(entry.participants.map((participant: { id: string }) => participant.id));
    expect(result.target).toEqual({ socketDir: '/owned/socket', port: 55434, database: 'bab' });
    expect(calls.filter((call) => call.sql === 'BEGIN')).toHaveLength(1);
    expect(calls.filter((call) => call.sql === 'COMMIT')).toHaveLength(1);
    expect(calls.filter((call) => call.sql.startsWith('insert into lobbies'))).toHaveLength(1);
    expect(calls.filter((call) => call.sql.startsWith('insert into participants'))).toHaveLength(entry.players);
    expect(calls.filter((call) => call.sql.startsWith('insert into lobby_teams'))).toHaveLength(entry.players);
    const lobbyCall = calls.find((call) => call.sql.startsWith('insert into lobbies'));
    expect(lobbyCall?.params[0]).toBe(entry.code);
    expect(lobbyCall?.params[1]).toBe('preview');
    expect(lobbyCall?.params[6]).toBe(entry.secret);
    expect(lobbyCall?.params[7]).toBe(entry.participants[0].id);
    const participantCalls = calls.filter((call) => call.sql.startsWith('insert into participants'));
    for (const [index, call] of participantCalls.entries()) {
      expect(call.params[2]).toBe(await hashSecret(secrets[index]));
      expect(call.params[6]).toBe(JSON.stringify(entry.participants[index].build));
      expect(call.params[7]).toBe(entry.participants[index].build.kind);
      expect(call.params[8]).toBe(JSON.stringify(entry.participants[index].summary));
    }
  });

  it('keeps secrets out of the result and logs', async () => {
    const { runner } = runnerStub();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '));
    });
    const result = await applyLeagueFixture({ entry, run: validRun, runner, secrets });
    spy.mockRestore();
    const text = JSON.stringify(result) + logs.join('\n');
    for (const secret of secrets) expect(text).not.toContain(secret);
  });
});
