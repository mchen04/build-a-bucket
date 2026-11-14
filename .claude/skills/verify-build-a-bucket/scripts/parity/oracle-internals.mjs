// Module-private helpers of the original, reached through ORACLE_EXPOSE (see hooks.mjs).
// Usage: ESBUILD=<esbuild pkg dir> ORACLE_EXPOSE='...' node --no-experimental-webstorage --import ./scripts/register.mjs scripts/oracle-internals.mjs <srcRoot> <seedInt>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, seedArg] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(path.resolve(root, p)).href);
const sim = await imp('src/utils/bucketSimulation.js');
const mb = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const rand = mb(Number(seedArg));
const standings = sim.__oracle_simConferenceStandings(50, 'BOS', 'east', rand);
const res = {
  series: [0.3, 0.5, 0.7].map((p) => sim.__oracle_simulateSeries(p, rand)),
  matchupProb: sim.__oracle_matchupProb(0.6, 'OKC'),
  teamWP: sim.__oracle_teamWP('DET'),
  standings: standings.seed ?? standings,
  playIn: sim.__oracle_simPlayIn(8, standings.standings, 0.55, rand),
};
if (process.env.WITH_UI) {
  const page = await imp('src/components/BucketSimPage.jsx');
  const r = sim.runBucketSimulation(Object.fromEntries(['jumpShot', 'finishing', 'passing', 'handles', 'perimeterDefense', 'speed', 'bounce', 'size', 'basketballIQ', 'clutch'].map((t) => [t, { val: 10 }])), ['jumpShot', 'finishing', 'passing', 'handles', 'perimeterDefense', 'speed', 'bounce', 'size', 'basketballIQ', 'clutch'], { short: 'OKC' }, 'guard', Number(seedArg));
  res.goatRank = page.__oracle_computeGoatRank(r, { mvp: { isPlayer: true }, dpoy: { isPlayer: false } });
  res.goatInput = { ovr: r.ovr, champion: r.champion, wins: r.wins, ppg: r.ppg };
  const cap = await imp('src/components/BucketSalaryCap.jsx');
  res.scoutGrade = [{ attrs: { finishing: 9 } }, { attrs: { handles: 6, passing: 7 } }, { attrs: {} }].map(cap.__oracle_calcGrade);
}
console.log(JSON.stringify(res));
process.exit(0);
