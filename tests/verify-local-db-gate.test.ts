import { afterEach, describe, expect, it } from 'vitest';
import { ownedPostgresEnv } from '../.claude/skills/verify-build-a-bucket/scripts/owned-postgres.mjs';
import { dbSuiteMode } from './local-db-gate';

const keys = ['BAB_DB_RUNNER', 'BAB_PG_SOCKET_DIR', 'BAB_PG_PORT', 'BAB_PG_DATABASE', 'DATABASE_URL'];
const saved = new Map(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    if (saved.get(key) === undefined) delete process.env[key];
    else process.env[key] = saved.get(key);
  }
});

function apply(env: Record<string, string>) {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, env);
}

describe('local db gate', () => {
  it('accepts the exact owned socket env', () => {
    apply(ownedPostgresEnv({ sockDir: '/tmp/sock', port: 55434, database: 'bab_local' }));
    expect(dbSuiteMode()).toBe('run');
  });

  it('skips without the runner', () => {
    apply({ DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/bab_local' });
    expect(dbSuiteMode()).toBe('skip');
  });

  it('throws for a hosted URL with the runner', () => {
    apply({ ...ownedPostgresEnv({ sockDir: '/tmp/sock', port: 55434, database: 'bab_local' }), DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/bab_local' });
    expect(() => dbSuiteMode()).toThrow('hosted');
  });

  it('throws for a wrong socket dir', () => {
    apply({ ...ownedPostgresEnv({ sockDir: '/tmp/sock', port: 55434, database: 'bab_local' }), DATABASE_URL: 'postgresql://postgres@/bab_local?host=%2Ftmp%2Fother&port=55434' });
    expect(() => dbSuiteMode()).toThrow('host');
  });

  it('throws for a wrong port', () => {
    apply({ ...ownedPostgresEnv({ sockDir: '/tmp/sock', port: 55434, database: 'bab_local' }), DATABASE_URL: 'postgresql://postgres@/bab_local?host=%2Ftmp%2Fsock&port=1' });
    expect(() => dbSuiteMode()).toThrow('port');
  });

  it('throws for a relative socket dir', () => {
    apply({ ...ownedPostgresEnv({ sockDir: '/tmp/sock', port: 55434, database: 'bab_local' }), BAB_PG_SOCKET_DIR: 'relative', DATABASE_URL: 'postgresql://postgres@/bab_local?host=relative&port=55434' });
    expect(() => dbSuiteMode()).toThrow('absolute');
  });
});
