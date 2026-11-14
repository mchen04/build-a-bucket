import './our-hooks.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSON5 from 'json5';
import { compare, describe } from '../../../../../tests/parity/compare.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const SHA = '92cb2a155bb2261cd68038ac366b994ad5dbb873';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const SEEDS = Number(flag('seeds', '20'));
const AREA = flag('area', 'all');
const CACHE = flag('cache', process.env.BAB_PARITY_CACHE ?? path.join(os.homedir(), '.cache', 'bab-parity'));
const WRITE_FIXTURES = has('write-fixtures');
const QUIET = has('quiet');

const { ensureSource } = await import('./fetch-cache.mjs');
const ours = await import(pathToFileURL(path.join(ROOT, 'tests/parity/ours.ts')).href);

const log = (message) => {
  if (!QUIET) process.stdout.write(`${message}\n`);
};

const srcRoot = await ensureSource(CACHE, log);
const read = (file) => fs.readFileSync(path.join(srcRoot, file), 'utf8');
const literal = (file, name) => {
  const source = read(file);
  const start = source.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`missing ${name} in ${file}`);
  const open = source.indexOf('[', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '[') depth++;
    else if (char === ']') {
      depth--;
      if (depth === 0) return JSON5.parse(source.slice(open, index + 1));
    }
  }
  throw new Error(`unterminated ${name}`);
};

const types = {
  guard: literal('src/data/nba-guards.js', 'GUARD_TYPES'),
  big: literal('src/data/nba-bigs.js', 'BIG_TYPES'),
};
const pools = {
  guards: literal('src/data/nba-guards.js', 'NBA_GUARD_PLAYERS'),
  bigs: literal('src/data/nba-bigs.js', 'NBA_BIG_PLAYERS'),
  legendGuards: literal('src/data/nba-guard-legends.js', 'NBA_ALLTIME_GUARD_PLAYERS'),
  legendBigs: literal('src/data/nba-big-legends.js', 'NBA_ALLTIME_BIG_PLAYERS'),
  legends: literal('src/data/nba-salary.js', 'GOAT_SALARY_PLAYERS'),
  teams: literal('src/data/nba-teams.js', 'NBA_TEAMS').map((team) => team.short),
};

const dayKey = (offset) => new Date(Date.UTC(2026, 10, 13) - offset * 86400000).toISOString().slice(0, 10);
const FIXED_DATES = ['2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18'];
const dates = (count) => [...FIXED_DATES, ...Array.from({ length: count }, (_, index) => dayKey(index))];
const seedList = Array.from({ length: SEEDS }, (_, index) => `b-parity-${index}`);
const seasonSeeds = Array.from({ length: SEEDS }, (_, index) => String(12345 + index * 7));
const squadSeeds = Array.from({ length: SEEDS }, (_, index) => `parity-${index}`);

const EXPOSE = JSON.stringify({ 'BucketSalaryCap.jsx': ['calcGrade', 'HARDCODED_GRIDS', 'budgetForDateStr'], 'bucketSimulation.js': ['teamWP'] });

const trimPlayer = (player) => ({
  name: player.name,
  short: player.short ?? null,
  team: player.team,
  number: player.number ?? null,
  starter: player.starter === true,
  position: player.position ?? null,
  posGroup: player.posGroup ?? null,
  legend: player.legend === true,
  attrs: player.attrs,
});
const trimPools = (value) =>
  value
    ? {
        guards: value.guards.map(trimPlayer),
        bigs: value.bigs.map(trimPlayer),
        legendGuards: value.legendGuards.map(trimPlayer),
        legendBigs: value.legendBigs.map(trimPlayer),
        legends: value.legends.map(trimPlayer),
        teams: value.teams,
      }
    : null;

function oracle(area, ...rest) {
  const stdout = execFileSync(
    process.execPath,
    ['--no-experimental-webstorage', '--import', './register-ui.mjs', './oracle-batch.mjs', srcRoot, area, ...rest.map(String)],
    {
      cwd: HERE,
      env: { ...process.env, ESBUILD: path.join(ROOT, 'node_modules/esbuild'), ORACLE_EXPOSE: EXPOSE },
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout.trim().split('\n').pop());
}

const cases = {
  ovr: () => ({ oracle: oracle('ovr'), ours: ours.ovrCase(types), types, args: {} }),
  spin: () => ({
    oracle: oracle('spin', seedList.join(','), 'guard', 'classic', '10'),
    ours: ours.spinCase(pools, seedList, 'guard', 10),
    pools,
    args: { seeds: seedList, pos: 'guard', count: 10 },
  }),
  daily: () => ({
    oracle: oracle('daily', dates(SEEDS).join(',')),
    ours: ours.dailyCase(pools, types, dates(SEEDS)),
    pools,
    types,
    args: { dates: dates(SEEDS) },
  }),
  season: () => ({
    oracle: oracle('season', seasonSeeds.join(','), 'BOS', 'classic'),
    ours: ours.seasonCase(pools, seasonSeeds, 'BOS', types),
    types,
    args: { seeds: seasonSeeds, team: 'BOS', mode: 'classic' },
  }),
  salary: () => ({
    oracle: oracle('salary', dates(SEEDS).join(',')),
    ours: ours.salaryCase(pools, dates(SEEDS)),
    pools,
    args: { dates: dates(SEEDS) },
  }),
  powers: () => ({
    oracle: oracle('powers', '2026-11-13', '99'),
    ours: ours.powersCase(pools, '2026-11-13', 99),
    pools,
    args: { date: '2026-11-13', drawSeed: 99 },
  }),
  squad: () => ({
    oracle: oracle('squad', squadSeeds.join(','), 'BOS'),
    ours: ours.squadCase(pools, types, squadSeeds, 'BOS'),
    types,
    args: { seeds: squadSeeds, team: 'BOS' },
  }),
};

const selected = AREA === 'all' ? Object.keys(cases) : AREA.split(',');
let failures = 0;
const summary = [];

for (const name of selected) {
  const entry = cases[name];
  if (!entry) throw new Error(`unknown area ${name}`);
  let result;
  try {
    result = entry();
  } catch (error) {
    failures++;
    summary.push(`${name}: ORACLE FAILED ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    continue;
  }
  const compared = compare(result.oracle, result.ours);
  if (compared.diffs.length) failures++;
  summary.push(`${name}: ${describe(compared)}`);
  if (WRITE_FIXTURES) {
    const dir = path.join(ROOT, 'tests/fixtures/oracle');
    fs.mkdirSync(dir, { recursive: true });
    if (result.pools) {
      fs.writeFileSync(
        path.join(dir, 'pools.json'),
        `${JSON.stringify({ sha: SHA, pools: trimPools(result.pools) }, null, 2)}\n`,
      );
    }
    fs.writeFileSync(
      path.join(dir, `${name}.json`),
      `${JSON.stringify({ sha: SHA, args: result.args, types: result.types ?? null, oracle: result.oracle }, null, 2)}\n`,
    );
  }
}

log(summary.join('\n'));
log(`areas: ${selected.length}, mismatched: ${failures}`);
process.exit(failures ? 1 : 0);
