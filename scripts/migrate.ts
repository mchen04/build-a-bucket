import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { neonClient, statementsFrom } from './lib.ts';

const source = await readFile(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8');
const statements = statementsFrom(source);
const sql = neonClient();
for (const statement of statements) {
  await sql.query(statement);
}
const expected = [
  'actions',
  'events',
  'league_slice_checkpoints',
  'league_slice_games',
  'league_slices',
  'lobby_teams',
  'lobbies',
  'participants',
];
const check = await sql.query<{ table_name: string }>(
  `select table_name from information_schema.tables where table_schema = 'public' and table_name in (${expected.map((name) => `'${name}'`).join(',')}) order by table_name`,
);
console.log(`db/schema.sql applied: ${statements.length} statements`);
const present = check.map((row) => row.table_name);
console.log(`tables present: ${present.join(', ')}`);
const missing = expected.filter((name) => !present.includes(name));
if (missing.length) {
  console.error(`missing tables: ${missing.join(', ')}`);
  process.exitCode = 1;
}
