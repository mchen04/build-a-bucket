// Oracle against the DEPLOYED bundle: progress chunk export `au` = qh (runBucketSimulation), `j` = hi (calcBucketOVR),
// `P` = Xh (guard archetype), `N` = Zh (big archetype). Same synthetic build as oracle-season.mjs.
// Usage: node --no-experimental-webstorage --import ./scripts/register-browser.mjs scripts/oracle-season-live.mjs <progressChunk> <seedInt> <team> <guard|big> [all-time]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [chunk, seedArg, team, pos = 'guard', mode = 'classic'] = process.argv.slice(2);
const m = await import(pathToFileURL(path.resolve(chunk)).href);
const GUARD_TYPES = ['jumpShot', 'finishing', 'passing', 'handles', 'perimeterDefense', 'speed', 'bounce', 'size', 'basketballIQ', 'clutch'];
const BIG_TYPES = ['jumpShot', 'finishing', 'rebounding', 'playmaking', 'interiorDefense', 'speed', 'bounce', 'size', 'basketballIQ', 'clutch'];
const types = pos === 'big' ? BIG_TYPES : GUARD_TYPES;
const build = Object.fromEntries(types.map((t, i) => [t, { val: [9, 7, 8, 6, 10, 5, 7, 8, 9, 6][i] }]));
const ovr = m.j(build, types, pos);
const arch = pos === 'big' ? m.N(ovr, build, types) : m.P(ovr, build, types);
const r = m.au(build, types, { short: team }, pos, Number(seedArg), mode);
console.log(JSON.stringify({ ovr, arch, wins: r.wins, losses: r.losses, seed: r.seed, winProb: r.winProb, champion: r.champion, madePlayoffs: r.madePlayoffs,
  line: { ppg: r.ppg, rpg: r.rpg, apg: r.apg, spg: r.spg, bpg: r.bpg, fg: r.fgPct, tp: r.threePct, ft: r.ftPct, tov: r.tov, per: r.per },
  rounds: (r.playoffRounds || []).map((x) => [x.type ?? x.name ?? x.round, x.opponent?.short ?? x.opponent, x.won ?? x.advanced, x.wins ?? x.myWins, x.losses ?? x.oppWins]),
  awards: { mvp: r.mvp, dpoy: r.dpoy, keys: Object.keys(r) }, firstGames: r.games.slice(0, 3) }));
process.exit(0);
