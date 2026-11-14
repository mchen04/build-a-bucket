// Inline React-component logic of the original, run from its exact source text.
// Each slice is cut between two anchor strings in the downloaded file and run with `new Function`, its free
// variables supplied as parameters and Math.random replaced by a seeded mulberry32 for the call.
// Usage: node --no-experimental-webstorage --import ./scripts/register.mjs scripts/oracle-slices.mjs <srcRoot> <spin|awards|shuffle> <args...>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, area, ...args] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(path.resolve(root, p)).href);
const text = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
function slice(file, from, to, { includeTo = true } = {}) {
  const s = text(file), a = s.indexOf(from);
  if (a < 0) throw new Error(`anchor not found in ${file}: ${from}`);
  const b = s.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`end anchor not found in ${file}: ${to}`);
  return s.slice(a, includeTo ? b + to.length : b);
}
const mb = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
function withRandom(seed, fn) { const real = Math.random; Math.random = mb(seed); try { return fn(); } finally { Math.random = real; } }
const run = (params, body, values) => new Function(...params, body)(...values);

if (area === 'spin') {
  // SpinScreen.jsx teamTarget / playerTarget useMemo bodies (solo build: autoPlan = { seed, respinSeed: seed + ':r', separateRespins: true })
  const [seed, pos = 'guard', mode = 'classic', spins = '10'] = args;
  const { seededTeamOrder, seededShuffle } = await imp('src/lib/rng.js');
  const V = await imp('src/lib/verifyCore.js');
  const kit = V.seasonKit('bucket', pos, mode);
  const teamBody = slice('src/components/SpinScreen.jsx', 'if (!seedPlan || spinCount < 1) return null', 'return order[teamIndex % order.length]');
  const playerBody = slice('src/components/SpinScreen.jsx', 'const own = ownSpins && (freeTeam || playerDraw > 0)', 'return order[playerDraw % order.length]');
  const seedPlan = { seed, respinSeed: `${seed}:r`, separateRespins: true };
  const teamReelItems = kit.teams.filter((t) => kit.pool.some((p) => p.team === t.short));
  const out = [];
  for (let i = 0; i < Number(spins); i++) {
    const team = run(['seedPlan', 'spinCount', 'teamReelItems', 'teamIndex', 'freeTeam', 'seededTeamOrder'], teamBody, [seedPlan, i + 1, teamReelItems, i, false, seededTeamOrder]);
    const player = run(['ownSpins', 'freeTeam', 'playerDraw', 'seedPlan', 'selectedTeam', 'qbPool', 'teamOf', 'seededShuffle', 'teamIndex'], playerBody, [true, false, 0, seedPlan, team, kit.pool, (q) => q.team, seededShuffle, i]);
    const respin = run(['ownSpins', 'freeTeam', 'playerDraw', 'seedPlan', 'selectedTeam', 'qbPool', 'teamOf', 'seededShuffle', 'teamIndex'], playerBody, [true, false, 1, seedPlan, team, kit.pool, (q) => q.team, seededShuffle, i]);
    out.push([team.short, player?.name, respin?.name]);
  }
  console.log(JSON.stringify({ seed, pos, mode, spins: out, pool: kit.pool.map((p) => [p.name, p.team]) }));
} else if (area === 'awards') {
  // BucketSimPage.jsx display awards useMemo body, on a seeded season and a seeded Math.random
  const [simSeed, team, pos = 'guard', gameMode = 'classic', drawSeed = '1'] = args;
  const sim = await imp('src/utils/bucketSimulation.js');
  const types = pos === 'big' ? (await imp('src/data/nba-bigs.js')).BIG_TYPES : (await imp('src/data/nba-guards.js')).GUARD_TYPES;
  const build = Object.fromEntries(types.map((t, i) => [t, { val: [9, 7, 8, 6, 10, 5, 7, 8, 9, 6][i] }]));
  const result = sim.runBucketSimulation(build, types, { short: team }, pos, Number(simSeed), gameMode);
  const body = slice('src/components/BucketSimPage.jsx', 'if (!result) return null\n    const { ppg, rpg, apg, spg, bpg, ovr, team } = result', 'return { mvp, dpoy }');
  const aw = withRandom(Number(drawSeed), () => run(['result', 'gameMode', 'userName'], body, [result, gameMode, 'Guest']));
  console.log(JSON.stringify({ line: [result.ppg, result.rpg, result.apg, result.spg, result.bpg, result.ovr], mvp: [aw.mvp.name, aw.mvp.ppg, aw.mvp.rpg, aw.mvp.apg], dpoy: [aw.dpoy.name, aw.dpoy.spg, aw.dpoy.bpg] }));
} else if (area === 'shuffle') {
  // BucketSalaryCap.jsx executeShuffleCol / executeShuffleRow derangement loops on a daily board, seeded Math.random
  const [date, kind, index, drawSeed = '1'] = args;
  const S = await imp('src/lib/salaryCore.js');
  const { BUCKET_SAL_POOL, SAL_COLS, salTypesFor } = await imp('src/data/nba-salary.js');
  const grid = S.salaryKit({ typesFor: salTypesFor }).dailyGrid(SAL_COLS, BUCKET_SAL_POOL, date);
  const file = 'src/components/BucketSalaryCap.jsx';
  if (kind === 'col') {
    const body = slice(file, 'const original = effectiveGrid[ci]', "id: `${p.name}-s-${ti}` }))") + '\nreturn newPlayers';
    const res = withRandom(Number(drawSeed), () => run(['effectiveGrid', 'ci', 'TIERS'], body, [grid, Number(index), S.TIERS]));
    console.log(JSON.stringify({ date, col: Number(index), before: grid[index].map((c) => c.name), after: res.map((c) => `${c.price}:${c.name}`) }));
  } else {
    const body = slice(file, 'const original = effectiveGrid.map(col => col[ti])', '} while (current.some((p, i) => p.name === original[i].name))') + '\nreturn current';
    const res = withRandom(Number(drawSeed), () => run(['effectiveGrid', 'ti'], body, [grid, Number(index)]));
    console.log(JSON.stringify({ date, row: Number(index), before: grid.map((c) => c[index].name), after: res.map((c) => c.name) }));
  }
}
process.exit(0);
