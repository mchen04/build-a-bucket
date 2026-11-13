// Oracle: original runBucketSimulation / calcBucketOVR / archetypes, seeded.
// Usage: node --import ./scripts/register.mjs scripts/oracle-season.mjs <srcRoot> <seedInt> <teamShort> <guard|big> [all-time]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, seedArg, team, pos = 'guard', mode = 'classic'] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(path.resolve(root, p)).href);
const sim = await imp('src/utils/bucketSimulation.js');
const { GUARD_TYPES } = await imp('src/data/nba-guards.js');
const { BIG_TYPES } = await imp('src/data/nba-bigs.js');
const types = pos === 'big' ? BIG_TYPES : GUARD_TYPES;
// fixed synthetic build: values 1..11 cycling
const build = Object.fromEntries(types.map((t, i) => [t, { val: [9, 7, 8, 6, 10, 5, 7, 8, 9, 6][i] }]));
const ovr = sim.calcBucketOVR(build, types, pos);
const arch = pos === 'big' ? sim.getBucketBigArchetype(ovr, build, types) : sim.getBucketGuardArchetype(ovr, build, types);
const r = sim.runBucketSimulation(build, types, { short: team }, pos, Number(seedArg), mode);
console.log(JSON.stringify({ ovr, arch, wins: r.wins, losses: r.losses, seed: r.seed, winProb: r.winProb, champion: r.champion, madePlayoffs: r.madePlayoffs,
  line: { ppg: r.ppg, rpg: r.rpg, apg: r.apg, spg: r.spg, bpg: r.bpg, fg: r.fgPct, tp: r.threePct, ft: r.ftPct, tov: r.tov, per: r.per },
  rounds: (r.playoffRounds || []).map((x) => [x.type ?? x.name ?? x.round, x.opponent?.short ?? x.opponent, x.won ?? x.advanced, x.wins ?? x.myWins, x.losses ?? x.oppWins]),
  awards: { mvp: r.mvp, dpoy: r.dpoy, keys: Object.keys(r) }, firstGames: r.games.slice(0, 3) }));
