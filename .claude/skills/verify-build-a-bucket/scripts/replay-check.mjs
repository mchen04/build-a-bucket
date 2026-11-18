import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function exactZero(file) {
  const text = readText(file);
  return text !== null && text.trim() === '0';
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function validRevision(revision) {
  return Boolean(
    revision &&
      typeof revision === 'object' &&
      typeof revision.stage === 'string' &&
      revision.stage.trim().length > 0 &&
      typeof revision.progress === 'string' &&
      revision.progress.trim().length > 0,
  );
}

function seatNumbers(seats) {
  const map = new Map();
  for (const entry of Array.isArray(seats) ? seats : []) {
    let number = null;
    let name = null;
    if (typeof entry === 'string') {
      const match = /^(\d+):(.+)$/.exec(entry.trim());
      if (match) {
        number = Number(match[1]);
        name = match[2].trim();
      }
    } else if (entry && typeof entry === 'object') {
      number = Number(entry.seat);
      name = typeof entry.name === 'string' ? entry.name.trim() : null;
    }
    if (!Number.isInteger(number) || number < 1 || !name) continue;
    if (!map.has(number)) map.set(number, new Set());
    map.get(number).add(name);
  }
  return map;
}

function validatePlan(plan) {
  const failures = [];
  if (!plan || typeof plan !== 'object') return ['plan is missing or malformed'];
  if (!Array.isArray(plan.runs) || plan.runs.length === 0) failures.push('plan.runs is empty');
  if (!Array.isArray(plan.suite)) failures.push('plan.suite is not an array');
  const names = new Set();
  for (const run of Array.isArray(plan.runs) ? plan.runs : []) {
    if (!run || typeof run.name !== 'string' || run.name.length === 0) {
      failures.push('plan run has no name');
      continue;
    }
    if (names.has(run.name)) failures.push(`plan run '${run.name}' is duplicated`);
    names.add(run.name);
    if (!isPositiveInt(run.players)) failures.push(`plan run '${run.name}' has invalid players`);
    if (typeof run.mode !== 'string' || run.mode.length === 0) failures.push(`plan run '${run.name}' has invalid mode`);
    if (typeof run.device !== 'string' || run.device.length === 0) failures.push(`plan run '${run.name}' has invalid device`);
    if (run.reloadSeat !== null && !isPositiveInt(run.reloadSeat)) failures.push(`plan run '${run.name}' has invalid reloadSeat`);
    if (!Array.isArray(run.args)) failures.push(`plan run '${run.name}' has invalid args`);
  }
  for (const step of Array.isArray(plan.suite) ? plan.suite : []) {
    if (!step || typeof step.id !== 'string' || step.id.length === 0) failures.push('plan suite step has no id');
    if (!Array.isArray(step.command) || step.command.length === 0) failures.push(`plan suite step '${step?.id}' has no command`);
  }
  return failures;
}

function checkRun(run, dir) {
  const failures = [];
  const meta = readJson(path.join(dir, 'run.json'));
  if (!meta) return ['missing or malformed run.json'];
  if (meta.label !== run.name) failures.push(`run.json label '${meta.label}' != '${run.name}'`);
  if (meta.players !== run.players) failures.push(`run.json players ${meta.players} != ${run.players}`);
  if (meta.mode !== run.mode) failures.push(`run.json mode '${meta.mode}' != '${run.mode}'`);
  if (meta.device !== run.device) failures.push(`run.json device '${meta.device}' != '${run.device}'`);
  if ((meta.reloadSeat ?? null) !== (run.reloadSeat ?? null)) failures.push(`run.json reloadSeat ${meta.reloadSeat} != ${run.reloadSeat}`);
  if (!exactZero(path.join(dir, 'exit'))) failures.push('exit is not exactly 0');
  const evidenceRoot = path.join(dir, 'evidence');
  const leagueDirs = fs.existsSync(evidenceRoot)
    ? fs.readdirSync(evidenceRoot).filter((entry) => entry.startsWith('league-') && fs.statSync(path.join(evidenceRoot, entry)).isDirectory())
    : [];
  const summaries = leagueDirs.map((entry) => path.join(evidenceRoot, entry, 'summary.json')).filter((file) => fs.existsSync(file));
  if (summaries.length !== 1) {
    failures.push(`${summaries.length} league summaries`);
    return failures;
  }
  const summary = readJson(summaries[0]);
  if (!summary) return [...failures, 'malformed summary.json'];
  if (!Array.isArray(summary.httpErrors)) failures.push('summary.httpErrors is not an array');
  if (!Array.isArray(summary.errors)) failures.push('summary.errors is not an array');
  if (Array.isArray(summary.httpErrors)) {
    const bad = summary.httpErrors.flatMap((entry) => (Array.isArray(entry.responses) ? entry.responses : [])).filter((response) => Number(response.status) >= 400 && Number(response.status) <= 499);
    if (bad.length) failures.push(`${bad.length} 4xx responses`);
  }
  if (Array.isArray(summary.errors)) {
    const count = summary.errors.reduce((sum, entry) => sum + (Array.isArray(entry.errors) ? entry.errors.length : 0), 0);
    if (count) failures.push(`${count} page errors`);
  }
  if (!summary.champion) failures.push('champion missing');
  if (summary.playAgain !== true) failures.push('Play Again not reached');
  if (run.reloadSeat !== null) {
    const reload = summary.reload;
    if (!reload || reload.ran !== true) failures.push('reload.ran is not true');
    if (!reload || !isPositiveInt(reload.rowsCompared)) failures.push('reload.rowsCompared is not a positive integer');
    if (!reload || !validRevision(reload.revision)) failures.push('reload.revision is not valid');
    if (!reload || reload.coverage !== 'ok') failures.push(`reload.coverage is '${reload?.coverage}'`);
    const identities = seatNumbers(reload?.seats);
    const conflict = [...identities].find(([, names]) => names.size > 1);
    if (conflict) failures.push(`reload.seats conflict for seat ${conflict[0]}`);
    if (identities.size < 2) failures.push(`reload.seats has ${identities.size} distinct seats`);
    if (!identities.has(run.reloadSeat)) failures.push(`reload.seats does not include seat ${run.reloadSeat}`);
  }
  return failures;
}

function checkCleanup(out) {
  const failures = [];
  const tracked = readJson(path.join(out, 'tracked.json'));
  if (!tracked) return ['cleanup: missing tracked.json'];
  if (!isPositiveInt(tracked.pid)) failures.push('cleanup: tracked pid is not a positive integer');
  if (!isPositiveInt(tracked.port)) failures.push('cleanup: tracked port is not a positive integer');
  if (tracked.pgPort !== undefined && tracked.pgPort !== null && !isPositiveInt(tracked.pgPort)) failures.push('cleanup: tracked pgPort is not a positive integer');
  if (!exactZero(path.join(out, 'cleanup.exit'))) failures.push('cleanup.exit is not exactly 0');
  const text = readText(path.join(out, 'cleanup-check.txt'));
  if (text === null) return [...failures, 'cleanup: missing cleanup-check.txt'];
  const map = new Map();
  for (const line of text.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
    const index = line.indexOf('=');
    if (index <= 0) {
      failures.push(`cleanup: malformed line '${line}'`);
      continue;
    }
    const key = line.slice(0, index);
    const value = line.slice(index + 1);
    if (map.has(key)) {
      failures.push(`cleanup: duplicate line '${key}'`);
      continue;
    }
    map.set(key, value);
  }
  const expected = new Map([
    ['pid', String(tracked.pid)],
    ['pid_alive', 'no'],
    ['port_listening', 'no'],
  ]);
  if (isPositiveInt(tracked.pgPort)) expected.set('pg_port_listening', 'no');
  for (const [key, value] of expected) {
    if (!map.has(key)) failures.push(`cleanup: missing '${key}'`);
    else if (map.get(key) !== value) failures.push(`cleanup: '${key}' is '${map.get(key)}', expected '${value}'`);
  }
  for (const key of map.keys()) if (!expected.has(key)) failures.push(`cleanup: unexpected line '${key}'`);
  return failures;
}

export function checkReplay({ out, planPath, expectedHead = null, cleanup = false }) {
  const failures = [];
  const plan = readJson(planPath);
  failures.push(...validatePlan(plan));
  if (failures.length) return { ok: false, rows: [], failures };
  const runsDir = path.join(out, 'runs');
  const actual = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((name) => fs.statSync(path.join(runsDir, name)).isDirectory()).sort() : [];
  const planned = plan.runs.map((run) => run.name).sort();
  for (const name of planned) if (!actual.includes(name)) failures.push(`missing run '${name}'`);
  for (const name of actual) if (!planned.includes(name)) failures.push(`extra run '${name}'`);
  const rows = [];
  for (const run of plan.runs) {
    const dir = path.join(runsDir, run.name);
    const runFailures = fs.existsSync(dir) ? checkRun(run, dir) : ['missing run directory'];
    rows.push({ name: run.name, failures: runFailures });
    failures.push(...runFailures.map((failure) => `${run.name}: ${failure}`));
  }
  for (const step of plan.suite) {
    if (!exactZero(path.join(out, 'suite', step.id, 'exit'))) failures.push(`suite ${step.id}: exit is not exactly 0`);
  }
  if (expectedHead) {
    const meta = readJson(path.join(out, 'meta.json'));
    if (!meta) failures.push('meta.json is missing or malformed');
    else if (meta.head !== expectedHead) failures.push(`meta.json head '${meta.head}' != '${expectedHead}'`);
  }
  if (cleanup) failures.push(...checkCleanup(out));
  return { ok: failures.length === 0, rows, failures };
}

export function runReplayCheck(argv) {
  const args = argv.slice();
  const out = args.shift();
  let planPath = null;
  let expectedHead = null;
  let cleanup = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--plan') planPath = args.shift();
    else if (arg === '--expected-head') expectedHead = args.shift();
    else if (arg === '--cleanup') cleanup = true;
    else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!out || !planPath) {
    console.error('usage: replay-check.mjs <out> --plan <plan.json> [--expected-head <sha>] [--cleanup]');
    process.exit(2);
  }
  const result = checkReplay({ out, planPath, expectedHead, cleanup });
  for (const row of result.rows) console.log(`${row.failures.length ? 'FAIL' : 'PASS'} ${row.name}${row.failures.length ? `: ${row.failures.join('; ')}` : ''}`);
  if (result.failures.length) {
    console.log('');
    for (const failure of result.failures) console.log(`- ${failure}`);
    console.log(`\nFAIL ${result.failures.length} check(s)`);
    process.exit(1);
  }
  console.log(`\nPASS ${result.rows.length} run(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runReplayCheck(process.argv.slice(2));
