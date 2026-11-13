import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { neonClient, statementsFrom } from './lib.ts';

const source = await readFile(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8');
const statements = statementsFrom(source);
const sql = neonClient();
for (const statement of statements) {
  await sql.query(statement);
}
const check = await sql.query<{ table_name: string }>(
  "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('lobbies','participants','lobby_teams','league_games','events','actions') order by table_name",
);
console.log(`db/schema.sql applied: ${statements.length} statements`);
console.log(`tables present: ${check.map((row) => row.table_name).join(', ')}`);
