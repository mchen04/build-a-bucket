import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, area, ...args] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(path.resolve(root, p)).href);
const out = (o) => console.log(JSON.stringify(o));
const list = (text) => String(text ?? '').split(',').filter(Boolean);
const mb = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const withRandom = (seed, fn) => {
  const real = Math.random;
  Math.random = mb(seed);
  try {
    return fn();
  } finally {
    Math.random = real;
  }
};
const text = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
const slice = (file, from, to) => {
  const src = text(file);
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`anchor missing in ${file}: ${from}`);
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`end anchor missing in ${file}: ${to}`);
  return src.slice(a, b + to.length);
};
const run = (params, body, values) => new Function(...params, body)(...values);

const BUILD_VALS = [9, 7, 8, 6, 10, 5, 7, 8, 9, 6];

async function syntheticBuild(pos) {
  const types = pos === 'big' ? (await imp('src/data/nba-bigs.js')).BIG_TYPES : (await imp('src/data/nba-guards.js')).GUARD_TYPES;
  const attrs = Object.fromEntries(types.map((t, i) => [t, { val: BUILD_VALS[i] }]));
  const values = Object.fromEntries(types.map((t, i) => [t, BUILD_VALS[i]]));
  return { types, attrs, values };
}

if (area === 'ovr') {
  const sim = await imp('src/utils/bucketSimulation.js');
  const result = {};
  for (const pos of ['guard', 'big']) {
    const { types, attrs } = await syntheticBuild(pos);
    const ovr = sim.calcBucketOVR(attrs, types, pos);
    result[pos] = {
      ovr,
      arch: pos === 'big' ? sim.getBucketBigArchetype(ovr, attrs, types) : sim.getBucketGuardArchetype(ovr, attrs, types),
    };
  }
  out(result);
} else if (area === 'spin') {
  const [seedsArg, pos = 'guard', mode = 'classic', count = '10'] = args;
  const V = await imp('src/lib/verifyCore.js');
  const { seededTeamOrder, seededShuffle } = await imp('src/lib/rng.js');
  const kit = V.seasonKit('bucket', pos, mode);
  const teamBody = slice('src/components/SpinScreen.jsx', 'if (!seedPlan || spinCount < 1) return null', 'return order[teamIndex % order.length]');
  const playerBody = slice('src/components/SpinScreen.jsx', 'const own = ownSpins && (freeTeam || playerDraw > 0)', 'return order[playerDraw % order.length]');
  const reel = kit.teams.filter((t) => kit.pool.some((p) => p.team === t.short)).slice().sort((a, b) => a.short.localeCompare(b.short));
  const rows = [];
  for (const seed of list(seedsArg)) {
    const seedPlan = { seed, respinSeed: `${seed}:r`, separateRespins: true };
    const spins = [];
    for (let i = 0; i < Number(count); i++) {
      const team = run(['seedPlan', 'spinCount', 'teamReelItems', 'teamIndex', 'freeTeam', 'seededTeamOrder'], teamBody, [seedPlan, i + 1, reel, i, false, seededTeamOrder]);
      const player = run(['ownSpins', 'freeTeam', 'playerDraw', 'seedPlan', 'selectedTeam', 'qbPool', 'teamOf', 'seededShuffle', 'teamIndex'], playerBody, [true, false, 0, seedPlan, team, kit.pool, (q) => q.team, seededShuffle, i]);
      const respin = run(['ownSpins', 'freeTeam', 'playerDraw', 'seedPlan', 'selectedTeam', 'qbPool', 'teamOf', 'seededShuffle', 'teamIndex'], playerBody, [true, false, 1, seedPlan, team, kit.pool, (q) => q.team, seededShuffle, i]);
      spins.push([team.short, player?.name ?? null, respin?.name ?? null]);
    }
    rows.push({ seed, spins });
  }
  out({ pos, mode, reel: reel.map((t) => t.short), poolSize: kit.pool.length, rows });
} else if (area === 'daily') {
  const V = await imp('src/lib/verifyCore.js');
  const { seededTeamOrder, seededShuffle } = await imp('src/lib/rng.js');
  const rows = [];
  for (const key of list(args[0])) {
    const dc = V.dailyFor(key);
    const row = { key, dc };
    if (dc.sport === 'bucket') {
      const kit = V.seasonKit(dc.sport, dc.pos, dc.mode);
      const draftable = new Set(kit.pool.map((p) => p.team));
      const reel = kit.teams.filter((t) => draftable.has(t.short)).slice().sort((a, b) => a.short.localeCompare(b.short));
      const order = seededTeamOrder(reel, `${dc.seed}:teams`);
      row.spins = kit.types.map((t, i) => {
        const team = order[i % order.length];
        const roster = kit.pool.filter((q) => q.team === team.short).sort((a, b) => a.name.localeCompare(b.name));
        return [team.short, seededShuffle(roster, `${dc.seed}:${i}:${team.short}`)[0]?.name ?? null];
      });
      const sent = Object.fromEntries(kit.types.map((t, i) => [t, { name: row.spins[i][1], team: row.spins[i][0] }]));
      const chk = V.checkDaily(key, sent);
      row.check = chk.error ?? { ovr: chk.ovr };
    }
    rows.push(row);
  }
  out({ rows });
} else if (area === 'season') {
  const sim = await imp('src/utils/bucketSimulation.js');
  const { NBA_TEAMS } = await imp('src/data/nba-teams.js');
  const { types, attrs } = await syntheticBuild('guard');
  const rows = [];
  for (const seed of list(args[0])) {
    const r = sim.runBucketSimulation(attrs, types, { short: args[1] ?? 'BOS' }, 'guard', Number(seed), args[2] ?? 'classic');
    rows.push({
      seed: Number(seed),
      ovr: r.ovr,
      wins: r.wins,
      losses: r.losses,
      confSeed: r.seed,
      champion: r.champion,
      madePlayoffs: r.madePlayoffs,
      line: [r.ppg, r.rpg, r.apg, r.spg, r.bpg, r.fgPct, r.threePct, r.ftPct, r.tov, r.per],
      rounds: (r.playoffRounds ?? []).map((x) => [x.type ?? x.round ?? x.name, x.opponent?.short ?? x.opponent, x.won ?? x.advanced ?? null, x.wins ?? x.myWins ?? null, x.losses ?? x.oppWins ?? null]),
      mvp: typeof r.mvp === 'boolean' ? r.mvp : null,
      dpoy: typeof r.dpoy === 'boolean' ? r.dpoy : null,
    });
  }
  out({ team: args[1] ?? 'BOS', teamWP: NBA_TEAMS.map((t) => [t.short, sim.__oracle_teamWP(t.short)]), rows });
} else if (area === 'salary') {
  const S = await imp('src/lib/salaryCore.js');
  const { BUCKET_SAL_POOL, SAL_COLS, salTypesFor } = await imp('src/data/nba-salary.js');
  const { NBA_TEAMS } = await imp('src/data/nba-teams.js');
  const kit = S.salaryKit({ typesFor: salTypesFor });
  const statsBody = `${slice('src/components/BucketSalaryCap.jsx', 'function calcStats(sel) {', 'return { overall, ppg, apg, rpg }')}\n}`;
  const calcStats = new Function('sel', statsBody + '\nreturn calcStats(sel);');
  const buildBody = `${slice('src/components/BucketSalaryCap.jsx', 'const buildFromSel = () => {', 'return build')}\n}`;
  const buildFromSel = new Function('sel', 'SAL_COLS', buildBody + '\nreturn buildFromSel();');
  const capModule = await imp('src/components/BucketSalaryCap.jsx');
  const hardcoded = capModule.__oracle_HARDCODED_GRIDS;
  const rows = [];
  for (const date of list(args[0])) {
    const grid = hardcoded[date.replace(/-/g, '')] ?? kit.dailyGrid(SAL_COLS, BUCKET_SAL_POOL, date);
    const picks = [1, 2, 3, 4, 4].map((ti, ci) => grid[ci][ti]);
    const dateSeed = parseInt(date.replace(/-/g, ''), 10);
    let h = dateSeed | 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x45d9f3b) | 0;
    h ^= h >>> 16;
    rows.push({
      date,
      budget: capModule.__oracle_budgetForDateStr(date),
      yesterdaySeed: S.yesterdaySeedOf(date),
      grid: grid.map((col) => col.map((c) => `${c.price}:${c.name}`)),
      infinite: kit
        .generateGrid(SAL_COLS, BUCKET_SAL_POOL, S.seededRandom(dateSeed), new Set(), dateSeed)
        .map((c) => c[0].name),
      preview: calcStats(picks),
      spent: picks.reduce((sum, p) => sum + p.price, 0),
      build: Object.fromEntries(Object.entries(buildFromSel(picks, SAL_COLS)).map(([key, entry]) => [key, entry.val])),
      salaryTeam: NBA_TEAMS[Math.floor(((h >>> 0) / 0x100000000) * NBA_TEAMS.length)].short,
    });
  }
  out({
    rows,
    teams: NBA_TEAMS.map((t) => t.short),
    pool: BUCKET_SAL_POOL.map((p) => ({ name: p.name, team: p.team, number: p.number ?? null, attrs: p.attrs, posGroup: p.posGroup ?? null, legend: p.legend === true })),
  });
} else if (area === 'powers') {
  const S = await imp('src/lib/salaryCore.js');
  const { BUCKET_SAL_POOL, SAL_COLS, salTypesFor } = await imp('src/data/nba-salary.js');
  const grid = S.salaryKit({ typesFor: salTypesFor }).dailyGrid(SAL_COLS, BUCKET_SAL_POOL, args[0]);
  const file = 'src/components/BucketSalaryCap.jsx';
  const cols = [];
  for (let ci = 0; ci < 5; ci++) {
    const body = `${slice(file, 'const original = effectiveGrid[ci]', 'id: `${p.name}-s-${ti}` }))')}\nreturn newPlayers`;
    const res = withRandom(Number(args[1]), () => run(['effectiveGrid', 'ci', 'TIERS'], body, [grid, ci, S.TIERS]));
    cols.push(res.map((p) => `${p.price}:${p.name}`));
  }
  const rows = [];
  for (let ti = 0; ti < 5; ti++) {
    const body = `${slice(file, 'const original = effectiveGrid.map(col => col[ti])', '} while (current.some((p, i) => p.name === original[i].name))')}\nreturn current`;
    const res = withRandom(Number(args[1]), () => run(['effectiveGrid', 'ti'], body, [grid, ti]));
    rows.push(res.map((p) => p.name));
  }
  const cap = await imp('src/components/BucketSalaryCap.jsx');
  out({
    date: args[0],
    before: grid.map((col) => col.map((c) => c.name)),
    columns: cols,
    rows,
    scout: [{ attrs: { finishing: 9 } }, { attrs: { handles: 6, passing: 7 } }, { attrs: {} }].map(cap.__oracle_calcGrade),
  });
} else if (area === 'squad') {
  const Q = await imp('src/lib/squad.js');
  const SS = await imp('src/lib/squadSeason.js');
  const { GUARD_TYPES } = await imp('src/data/nba-guards.js');
  const { BIG_TYPES } = await imp('src/data/nba-bigs.js');
  const vals = [
    [9, 7, 8, 6, 10, 5, 7, 8, 9, 6],
    [6, 8, 7, 9, 5, 10, 6, 7, 8, 9],
    [7, 7, 7, 7, 7, 7, 7, 7, 7, 7],
    [8, 9, 10, 5, 9, 4, 6, 10, 7, 6],
    [5, 10, 9, 4, 10, 3, 5, 11, 6, 7],
  ];
  const rows = [];
  for (const seed of list(args[0])) {
    let sq = Q.newSquad({ sport: 'bucket', uid: null, picks: [0, 1, 2, 3, 4], pool: 'current' });
    sq = { ...sq, seed, team: args[1] ?? 'BOS' };
    sq.slots.forEach((slot, i) => {
      const types = slot.pos === 'big' ? BIG_TYPES : GUARD_TYPES;
      sq = Q.fillSlot(sq, slot.id, Object.fromEntries(types.map((t, k) => [t, { val: vals[i][k] }])), types, false);
    });
    const strength = SS.squadStrength(sq);
    const r = SS.runSquadSeason(sq);
    rows.push({
      seed,
      strength: [+strength.off.toFixed(3), +strength.def.toFixed(3)],
      wins: r.wins,
      losses: r.losses,
      confSeed: r.seed,
      playoffs: r.playoffs,
      champion: r.champion,
      finals: r.finals,
      rounds: r.rounds.map((x) => [x.type, x.opponent, x.wins, x.losses]),
    });
  }
  out({ team: args[1] ?? 'BOS', rows });
} else {
  throw new Error(`unknown area ${area}`);
}
