import { neonClient } from '../../../../scripts/lib.ts';

const codes = process.argv.slice(2).filter((c) => /^[A-Z2-9]{6}$/.test(c));
const sql = neonClient();
const rows = codes.length ? await sql.query<{ code: string }>('delete from lobbies where code = any($1::text[]) returning code', [codes]) : [];
console.log(JSON.stringify(rows.map((r) => r.code)));
