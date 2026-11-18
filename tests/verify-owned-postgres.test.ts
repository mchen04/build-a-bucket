import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSocketPath, createOwnedPostgres } from '../.claude/skills/verify-build-a-bucket/scripts/owned-postgres.mjs';

class FakeChild {
  pid: number;
  exitCode: number | null = null;
  signalCode: string | null = null;
  signals: string[] = [];
  constructor(pid: number) {
    this.pid = pid;
  }
  kill(signal: string) {
    this.signals.push(signal);
    this.exitCode = 0;
    return true;
  }
}

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'r27-'));
  temps.push(dir);
  return dir;
}

function initFor(child: FakeChild) {
  return ({ dataDir, sockDir, port }: { dataDir: string; sockDir: string; port: number }) => {
    writeFileSync(path.join(dataDir, 'postmaster.pid'), `${child.pid}\n`);
    writeFileSync(path.join(sockDir, `.s.PGSQL.${port}`), '');
  };
}

describe('owned postgres', () => {
  it('creates the database and loads the schema over the owned socket', async () => {
    const root = tempDir();
    const child = new FakeChild(500);
    const sql: string[] = [];
    const owned = await createOwnedPostgres({
      root,
      port: 55434,
      database: 'bab_local',
      schema: '/schema.sql',
      spawn: () => child,
      initdb: initFor(child),
      psql: (text: string) => {
        sql.push(text);
        return '1';
      },
      schemaLoad: () => {
        sql.push('schema');
      },
      clock: { setTimeout: (fn: () => void) => fn() },
    });
    expect(sql).toEqual(['select 1', 'create database bab_local', 'schema']);
    expect(owned.env.BAB_PG_SOCKET_DIR).toBe(owned.sockDir);
    expect(owned.env.DATABASE_URL).toContain('host=');
  });

  it('issues no SQL when the owned child has already exited', async () => {
    const root = tempDir();
    const child = new FakeChild(500);
    child.exitCode = 1;
    const sql: string[] = [];
    await expect(
      createOwnedPostgres({
        root,
        port: 55434,
        database: 'bab_local',
        schema: '/schema.sql',
        spawn: () => child,
        initdb: initFor(child),
        psql: (text: string) => {
          sql.push(text);
          return '1';
        },
        schemaLoad: () => {
          sql.push('schema');
        },
        clock: { setTimeout: (fn: () => void) => fn() },
      }),
    ).rejects.toThrow('did not become ready');
    expect(sql).toEqual([]);
  });

  it('issues no SQL when postmaster.pid does not match', async () => {
    const root = tempDir();
    const child = new FakeChild(500);
    const sql: string[] = [];
    await expect(
      createOwnedPostgres({
        root,
        port: 55434,
        database: 'bab_local',
        schema: '/schema.sql',
        spawn: () => child,
        initdb: ({ dataDir, sockDir, port }: { dataDir: string; sockDir: string; port: number }) => {
          writeFileSync(path.join(dataDir, 'postmaster.pid'), '999\n');
          writeFileSync(path.join(sockDir, `.s.PGSQL.${port}`), '');
        },
        psql: (text: string) => {
          sql.push(text);
          return '1';
        },
        schemaLoad: () => {
          sql.push('schema');
        },
        clock: { setTimeout: (fn: () => void) => fn() },
      }),
    ).rejects.toThrow('did not become ready');
    expect(sql).toEqual([]);
  });

  it('rejects a socket path over 103 bytes before spawning', () => {
    expect(() => checkSocketPath('/' + 'a'.repeat(120), 55434)).toThrow('socket path too long');
  });
});
