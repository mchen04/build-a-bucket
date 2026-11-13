import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { describe, expect, it } from 'vitest';
import { loadLocalEnv, statementsFrom } from '../scripts/lib.ts';

loadLocalEnv();
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('migration rehearsal', () => {
  it('applies the new schema to old rows without stranding them', async () => {
    const client = neon(process.env.DATABASE_URL as string);
    const legacy = statementsFrom(await readFile(path.join(process.cwd(), 'db', 'legacy-schema.sql'), 'utf8'));
    const current = statementsFrom(await readFile(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8'));
    const schema = `rehearsal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const queries: { text: string; params: unknown[] }[] = [
      { text: `create schema ${schema}`, params: [] },
      { text: `set local search_path to ${schema}`, params: [] },
      ...legacy.map((text) => ({ text, params: [] })),
      {
        text: `insert into lobbies (code, phase) values
          ('OLD001', 'barrier'), ('OLD002', 'finished'), ('OLD003', 'season'),
          ('OLD004', 'building'), ('OLD005', 'lobby')`,
        params: [],
      },
      {
        text: `insert into participants (lobby_id, token_hash, name, seat, status, build)
          select id, 'hash-' || code, 'Old ' || code, 1, 'qualified', '{"kind":"normal"}'::jsonb
          from lobbies`,
        params: [],
      },
      {
        text: `create table league_games (
          lobby_id uuid not null references lobbies (id) on delete cascade,
          game_no int not null,
          kind text not null,
          stage int not null,
          home text not null,
          away text not null,
          home_score int not null,
          away_score int not null,
          winner text not null,
          primary key (lobby_id, game_no)
        )`,
        params: [],
      },
      ...current.map((text) => ({ text, params: [] })),
      {
        text: `insert into lobbies (code, phase, mode, era) values ('NEW001', 'rematch', 'salary', 'current')`,
        params: [],
      },
      {
        text: `insert into participants (lobby_id, token_hash, name, seat, status, salary_powers)
          select id, 'new-hash', 'New', 1, 'ready', '{"shuffle":true}'::jsonb from lobbies where code = 'NEW001'`,
        params: [],
      },
      {
        text: `select code, phase from lobbies where code in ('OLD001', 'OLD002', 'OLD003', 'OLD004', 'OLD005', 'NEW001') order by code`,
        params: [],
      },
      {
        text: `select status, build is null as cleared from participants where lobby_id = (select id from lobbies where code = 'OLD001')`,
        params: [],
      },
      {
        text: `select count(*)::int as n from information_schema.tables where table_schema = '${schema}' and table_name = 'league_games'`,
        params: [],
      },
      {
        text: `select count(*)::int as n from information_schema.columns where table_schema = '${schema}' and table_name = 'participants' and column_name = 'salary_powers'`,
        params: [],
      },
      { text: `drop schema ${schema} cascade`, params: [] },
    ];
    const results = (await client.transaction((txn) => queries.map((entry) => txn.query(entry.text, entry.params)))) as unknown[][];
    const phases = results[queries.length - 5] as { code: string; phase: string }[];
    expect(phases).toEqual([
      { code: 'NEW001', phase: 'rematch' },
      { code: 'OLD001', phase: 'recap' },
      { code: 'OLD002', phase: 'recap' },
      { code: 'OLD003', phase: 'recap' },
      { code: 'OLD004', phase: 'lobby' },
      { code: 'OLD005', phase: 'lobby' },
    ]);
    const participant = results[queries.length - 4] as { status: string; cleared: boolean }[];
    expect(participant[0]?.status).toBe('joined');
    expect(participant[0]?.cleared).toBe(true);
    const leagueGames = results[queries.length - 3] as { n: number }[];
    expect(leagueGames[0]?.n).toBe(0);
    const salaryPowers = results[queries.length - 2] as { n: number }[];
    expect(salaryPowers[0]?.n).toBe(1);
  }, 60_000);
});
