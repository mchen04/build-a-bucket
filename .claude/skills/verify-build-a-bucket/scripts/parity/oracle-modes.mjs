// Oracles for Daily, Salary Cap and Squad from the original's source at the pinned commit.
// Usage: node --no-experimental-webstorage --import ./scripts/register.mjs scripts/oracle-modes.mjs <srcRoot> <daily|salary|squad|spin> <args...>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, area, ...args] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(path.resolve(root, p)).href);
const out = (o) => console.log(JSON.stringify(o));

if (area === 'daily') {
  // verifyCore.dailyFor + the day's spin deals exactly as checkDaily/SpinScreen derive them
  const V = await imp('src/lib/verifyCore.js');
  const { seededTeamOrder, seededShuffle } = await imp('src/lib/rng.js');
  const key = args[0];
  const dc = V.dailyFor(key);
  const res = { dc };
  if (dc.sport === 'bucket') {
    const kit = V.seasonKit(dc.sport, dc.pos, dc.mode);
    const draftable = new Set(kit.pool.map((p) => p.team));
    const reel = kit.teams.filter((t) => draftable.has(t.short)).slice().sort((a, b) => a.short.localeCompare(b.short));
    const order = seededTeamOrder(reel, `${dc.seed}:teams`);
    res.spins = kit.types.map((t, i) => { const team = order[i % order.length]; const roster = kit.pool.filter((q) => q.team === team.short).sort((a, b) => a.name.localeCompare(b.name)); return [team.short, seededShuffle(roster, `${dc.seed}:${i}:${team.short}`)[0]?.name]; });
    // feed the dealt build back through the original's own server check
    const sent = Object.fromEntries(kit.types.map((t, i) => [t, { name: res.spins[i][1], team: res.spins[i][0] }]));
    const chk = V.checkDaily(key, sent);
    res.checkDaily = chk.error ?? { ovr: chk.ovr };
  }
  out(res);
} else if (area === 'salary') {
  const S = await imp('src/lib/salaryCore.js');
  const { BUCKET_SAL_POOL, SAL_COLS, salTypesFor } = await imp('src/data/nba-salary.js');
  const V = await imp('src/lib/verifyCore.js');
  const date = args[0];
  const kit = S.salaryKit({ typesFor: salTypesFor });
  const grid = kit.dailyGrid(SAL_COLS, BUCKET_SAL_POOL, date);
  const picks = [1, 2, 3, 4, 4].map((ti, ci) => grid[ci][ti]); // $40+30+20+10+10 = $110
  const chk = V.checkSalaryCap({ sport: 'bucket', date, picks: picks.map((p) => ({ name: p.name, team: p.team, price: p.price })) });
  // the salary season (BucketApp handleSalaryCapConfirm): team by the date hash, sim on the date seed
  const dateSeed = parseInt(date.replace(/-/g, ''), 10);
  let h = dateSeed | 0; h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) | 0; h ^= h >>> 16;
  const { NBA_TEAMS } = await imp('src/data/nba-teams.js');
  out({ budget: S.budgetForDateStr(date), yesterdaySeed: S.yesterdaySeedOf(date), recent: [...kit.getPickedNamesForSeed(S.yesterdaySeedOf(date), SAL_COLS, BUCKET_SAL_POOL)].slice(0, 5),
    grid: grid.map((col) => col.map((c) => `${c.price}:${c.name}`)), infinite: kit.generateGrid(SAL_COLS, BUCKET_SAL_POOL, S.seededRandom(Number(args[1] ?? 1)), new Set(), Number(args[1] ?? 1)).map((c) => c[0].name),
    check: chk.error ?? (chk.row && { overall: chk.row.overall_score, ppg: chk.row.ppg, apg: chk.row.apg, rpg: chk.row.rpg, spent: chk.row.budget_used }),
    salaryTeam: NBA_TEAMS[Math.floor(((h >>> 0) / 0x100000000) * NBA_TEAMS.length)].short,
    teams: NBA_TEAMS.map((t) => t.short),
    pool: BUCKET_SAL_POOL.map((p) => ({ name: p.name, team: p.team, attrs: p.attrs, posGroup: p.posGroup, legend: p.legend })) });
} else if (area === 'squad') {
  const Q = await imp('src/lib/squad.js');
  const SS = await imp('src/lib/squadSeason.js');
  const { GUARD_TYPES } = await imp('src/data/nba-guards.js');
  const { BIG_TYPES } = await imp('src/data/nba-bigs.js');
  const [seed, team, pool = 'current'] = args;
  let sq = Q.newSquad({ sport: 'bucket', uid: null, picks: [0, 1, 2, 3, 4], pool });
  sq = { ...sq, seed, team };
  const vals = [[9, 7, 8, 6, 10, 5, 7, 8, 9, 6], [6, 8, 7, 9, 5, 10, 6, 7, 8, 9], [7, 7, 7, 7, 7, 7, 7, 7, 7, 7], [8, 9, 10, 5, 9, 4, 6, 10, 7, 6], [5, 10, 9, 4, 10, 3, 5, 11, 6, 7]];
  sq.slots.forEach((s, i) => { const types = s.pos === 'big' ? BIG_TYPES : GUARD_TYPES; sq = Q.fillSlot(sq, s.id, Object.fromEntries(types.map((t, k) => [t, { val: vals[i][k] }])), types, false); });
  const str = SS.squadStrength(sq);
  const r = SS.runSquadSeason(sq);
  out({ strength: { off: +str.off.toFixed(3), def: +str.def.toFixed(3) }, wins: r.wins, losses: r.losses, seed: r.seed, playoffs: r.playoffs, champion: r.champion, finals: r.finals,
    rounds: r.rounds.map((x) => [x.type, x.opponent, x.wins, x.losses]), lines: r.lines.map((l) => [l.pos, l.ovr, l.stats, l.award?.name ?? null, l.honor ?? null]), log: r.log.slice(0, 20) });
}
