import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { loadLocalEnv, statementsFrom } from '../scripts/lib.ts';
import { dbSuite } from './local-db-gate';
import { db } from '../src/server/db';

loadLocalEnv();
const describeDb = dbSuite();

const NEW_CODES = [
  'NEWLOBBY',
  'NEWDRAW',
  'NEWBUILDING',
  'NEWBUILDFIRST',
  'NEWPREVIEW',
  'NEWSEASON',
  'NEWAWARDS',
  'NEWPLAYIN',
  'NEWPLAYOFFS',
  'NEWRECAP',
  'NEWREMATCH',
];

describeDb('migration rehearsal', () => {
  it('normalises legacy rows once and leaves live new-code lobbies untouched on a rerun', async () => {
    const legacy = statementsFrom(await readFile(path.join(process.cwd(), 'db', 'legacy-schema.sql'), 'utf8'));
    const current = statementsFrom(await readFile(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8'));
    const schema = `rehearsal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const queries: { text: string; params: unknown[] }[] = [];
    const marks = new Map<string, number>();
    const add = (key: string, text: string, params: unknown[] = []): void => {
      marks.set(key, queries.length);
      queries.push({ text, params });
    };

    add('schema', `create schema ${schema}`);
    add('path', `set local search_path to ${schema}`);
    for (const text of legacy) add('legacy', text);
    add(
      'legacyRows',
      `insert into lobbies (code, phase) values
        ('OLD001', 'barrier'), ('OLD002', 'finished'), ('OLD003', 'season'),
        ('OLD004', 'building'), ('OLD005', 'lobby')`,
    );
    add(
      'legacyParticipants',
      `insert into participants (lobby_id, token_hash, name, seat, status, build)
        select id, 'hash-' || code, 'Old ' || code, 1, 'qualified', '{"kind":"normal"}'::jsonb
        from lobbies`,
    );
    add(
      'legacyGames',
      `create table league_games (
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
    );
    for (const text of current) add('migrateOne', text);
    add(
      'newLobbies',
      `insert into lobbies
        (code, phase, settings, mode, era, version, league, league_version, stage, stage_cursor, stage_started_at, locked_at)
       values
        ('NEWLOBBY', 'lobby', '{}', 'normal', 'current', 1, null, 0, 0, 0, null, null),
        ('NEWDRAW', 'draw', '{}', 'normal', 'current', 1, null, 0, 0, 0, null, null),
        ('NEWBUILDING', 'building', '{}', 'salary', 'current', 1, null, 0, 0, 0, null, now()),
        ('NEWBUILDFIRST', 'building', '{"mode":"normal","era":"current"}', 'normal', 'current', 1, null, 0, 0, 0, null, null),
        ('NEWPREVIEW', 'preview', '{}', 'normal', 'current', 1, null, 0, 0, 0, null, now()),
        ('NEWSEASON', 'season', '{}', 'normal', 'current', 1, '{}'::jsonb, 1, 1, 40, now(), now()),
        ('NEWAWARDS', 'awards', '{}', 'normal', 'current', 1, '{}'::jsonb, 1, 4, 0, now(), now()),
        ('NEWPLAYIN', 'playin', '{}', 'normal', 'current', 1, '{}'::jsonb, 1, 5, 6, now(), now()),
        ('NEWPLAYOFFS', 'playoffs', '{}', 'normal', 'current', 1, '{}'::jsonb, 1, 7, 4, now(), now()),
        ('NEWRECAP', 'recap', '{}', 'normal', 'current', 1, '{}'::jsonb, 1, 10, 0, now(), now()),
        ('NEWREMATCH', 'rematch', '{}', 'normal', 'current', 1, null, 0, 0, 0, null, null)`,
    );
    add(
      'newParticipants',
      `insert into participants
        (lobby_id, token_hash, name, seat, status, build, build_kind, build_summary, ready_stage, preview_ready, salary_powers)
       values
        ((select id from lobbies where code = 'NEWLOBBY'), 'nh-lobby', 'Lobby', 1, 'joined', null, null, null, -1, false, null),
        ((select id from lobbies where code = 'NEWDRAW'), 'nh-draw', 'Draw', 1, 'joined', null, null, null, -1, false, null),
        ((select id from lobbies where code = 'NEWBUILDING'), 'nh-b1', 'Build', 1, 'building', '{"kind":"normal"}'::jsonb, 'normal', '{"filled":4}'::jsonb, -1, false, '{"shuffle":true}'::jsonb),
        ((select id from lobbies where code = 'NEWBUILDING'), 'nh-b2', 'Left', 2, 'left', '{"kind":"normal"}'::jsonb, 'normal', '{"filled":10}'::jsonb, 0, true, null),
        ((select id from lobbies where code = 'NEWBUILDFIRST'), 'nh-bf', 'BuildFirst', 1, 'ready', '{"kind":"normal"}'::jsonb, 'normal', '{"filled":10}'::jsonb, -1, false, null),
        ((select id from lobbies where code = 'NEWPREVIEW'), 'nh-prev', 'Preview', 1, 'ready', '{"kind":"normal"}'::jsonb, 'normal', '{"filled":10}'::jsonb, 0, true, null),
        ((select id from lobbies where code = 'NEWSEASON'), 'nh-season', 'Season', 1, 'ready', '{"kind":"normal"}'::jsonb, 'normal', '{"filled":10}'::jsonb, 2, true, null),
        ((select id from lobbies where code = 'NEWAWARDS'), 'nh-awards', 'Awards', 1, 'ready', '{"kind":"normal"}'::jsonb, 'normal', '{"filled":10}'::jsonb, 4, true, null),
        ((select id from lobbies where code = 'NEWPLAYIN'), 'nh-playin', 'PlayIn', 1, 'ready', '{"kind":"normal"}'::jsonb, 'normal', '{"filled":10}'::jsonb, 5, true, null),
        ((select id from lobbies where code = 'NEWPLAYOFFS'), 'nh-playoffs', 'Playoffs', 1, 'ready', '{"kind":"normal"}'::jsonb, 'normal', '{"filled":10}'::jsonb, 7, true, null),
        ((select id from lobbies where code = 'NEWRECAP'), 'nh-recap', 'Recap', 1, 'ready', '{"kind":"normal"}'::jsonb, 'normal', '{"filled":10}'::jsonb, 10, true, null),
        ((select id from lobbies where code = 'NEWREMATCH'), 'nh-rematch', 'Rematch', 1, 'joined', null, null, null, -1, true, null)`,
    );
    add(
      'beforePhases',
      `select code, phase, league_version, locked_at is null as unlocked
       from lobbies where code = any($1::text[]) order by code`,
      [NEW_CODES],
    );
    add(
      'beforeParts',
      `select l.code, p.seat, p.status, p.build, p.ready_stage, p.preview_ready, p.salary_powers
       from participants p join lobbies l on l.id = p.lobby_id
       where l.code = any($1::text[]) order by l.code, p.seat`,
      [NEW_CODES],
    );
    for (const text of current) add('migrateTwo', text);
    add(
      'afterPhases',
      `select code, phase, league_version, locked_at is null as unlocked
       from lobbies where code = any($1::text[]) order by code`,
      [NEW_CODES],
    );
    add(
      'afterParts',
      `select l.code, p.seat, p.status, p.build, p.ready_stage, p.preview_ready, p.salary_powers
       from participants p join lobbies l on l.id = p.lobby_id
       where l.code = any($1::text[]) order by l.code, p.seat`,
      [NEW_CODES],
    );
    add(
      'legacyPhases',
      `select code, phase from lobbies where code like 'OLD%' order by code`,
    );
    add(
      'legacyParticipant',
      `select status, build is null as cleared from participants where lobby_id = (select id from lobbies where code = 'OLD001')`,
    );
    add(
      'leagueGames',
      `select count(*)::int as n from information_schema.tables where table_schema = '${schema}' and table_name = 'league_games'`,
    );
    add(
      'salaryPowers',
      `select count(*)::int as n from information_schema.columns where table_schema = '${schema}' and table_name = 'participants' and column_name = 'salary_powers'`,
    );
    add(
      'claimColumn',
      `select count(*)::int as n from information_schema.columns where table_schema = '${schema}' and table_name = 'lobbies' and column_name = 'league_claimed_at'`,
    );
    add('drop', `drop schema ${schema} cascade`);

    const results = (await db().transaction(queries)) as unknown[][];
    const result = <T>(key: string): T => results[marks.get(key) as number] as T;

    expect(result<{ code: string; phase: string }[]>('legacyPhases')).toEqual([
      { code: 'OLD001', phase: 'recap' },
      { code: 'OLD002', phase: 'recap' },
      { code: 'OLD003', phase: 'recap' },
      { code: 'OLD004', phase: 'lobby' },
      { code: 'OLD005', phase: 'lobby' },
    ]);
    expect(result<{ status: string; cleared: boolean }[]>('legacyParticipant')[0]).toEqual({ status: 'joined', cleared: true });
    expect(result<{ code: string; phase: string; league_version: number; unlocked: boolean }[]>('beforePhases')).toEqual(
      result<{ code: string; phase: string; league_version: number; unlocked: boolean }[]>('afterPhases'),
    );
    expect(result<unknown[]>('beforeParts')).toEqual(result<unknown[]>('afterParts'));
    expect(result<{ n: number }[]>('leagueGames')[0]?.n).toBe(0);
    expect(result<{ n: number }[]>('salaryPowers')[0]?.n).toBe(1);
    expect(result<{ n: number }[]>('claimColumn')[0]?.n).toBe(1);
  }, 60_000);
});
