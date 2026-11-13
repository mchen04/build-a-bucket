import { neonClient } from './lib.ts';

const hours = Number(process.argv[2] ?? 24);
if (!Number.isFinite(hours) || hours <= 0) {
  console.error('usage: npm run prune:lobbies -- [idleHours]');
  process.exit(1);
}
const sql = neonClient();
const removed = await sql.query<{ id: string; code: string }>(
  "delete from lobbies where updated_at < now() - make_interval(hours => $1::int) returning id, code",
  [Math.floor(hours)],
);
const remaining = await sql.query<{ count: string }>(
  'select count(*)::text as count from lobbies where updated_at < now() - make_interval(hours => $1::int)',
  [Math.floor(hours)],
);
console.log(`pruned ${removed.length} lobbies idle for more than ${Math.floor(hours)}h`);
console.log(`remaining lobbies older than that window: ${remaining[0]?.count ?? 'unknown'}`);
