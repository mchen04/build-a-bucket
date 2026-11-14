// Squad season against the DEPLOYED bundle: squad chunk `newSquad`/`fillSlot` (real export names),
// squadSeason chunk export `q` = Mn = runSquadSeason (located by its `(t,{raw:e=!1}={})` signature).
// Usage: node --no-experimental-webstorage --import ./scripts/register-browser.mjs scripts/oracle-squad-live.mjs <liveDir> <seed> <team> [alltime]
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const [dir, seed, team, pool = 'current'] = process.argv.slice(2);
const find = (re) => path.resolve(dir, fs.readdirSync(dir).find((f) => re.test(f)));
const Q = await import(pathToFileURL(find(/^squad-[\w-]+\.js$/)).href);
const SS = await import(pathToFileURL(find(/^squadSeason-[\w-]+\.js$/)).href);
const GUARD_TYPES = ['jumpShot', 'finishing', 'passing', 'handles', 'perimeterDefense', 'speed', 'bounce', 'size', 'basketballIQ', 'clutch'];
const BIG_TYPES = ['jumpShot', 'finishing', 'rebounding', 'playmaking', 'interiorDefense', 'speed', 'bounce', 'size', 'basketballIQ', 'clutch'];
let sq = Q.newSquad({ sport: 'bucket', uid: null, picks: [0, 1, 2, 3, 4], pool });
sq = { ...sq, seed, team };
const vals = [[9, 7, 8, 6, 10, 5, 7, 8, 9, 6], [6, 8, 7, 9, 5, 10, 6, 7, 8, 9], [7, 7, 7, 7, 7, 7, 7, 7, 7, 7], [8, 9, 10, 5, 9, 4, 6, 10, 7, 6], [5, 10, 9, 4, 10, 3, 5, 11, 6, 7]];
sq.slots.forEach((s, i) => { const types = s.pos === 'big' ? BIG_TYPES : GUARD_TYPES; sq = Q.fillSlot(sq, s.id, Object.fromEntries(types.map((t, k) => [t, { val: vals[i][k] }])), types, false); });
const r = SS.q(sq);
console.log(JSON.stringify({ wins: r.wins, losses: r.losses, seed: r.seed, playoffs: r.playoffs, champion: r.champion, finals: r.finals,
  rounds: r.rounds.map((x) => [x.type, x.opponent, x.wins, x.losses]), lines: r.lines.map((l) => [l.pos, l.ovr, l.stats, l.award?.name ?? null, l.honor ?? null]), log: r.log.slice(0, 20) }));
process.exit(0);
