import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gateReadiness, recapElimination, refreshCoverage, revisionLabel } from './standings-check.mjs';
import { reloadCaptureBase } from './reload-boundary.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

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

function isFullSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function isShortSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{7,40}$/.test(value);
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
  const fixtures = new Set();
  let qualifyingReloads = 0;
  let allEliminatedReloads = 0;
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
    if (run.awaySeat !== null && !isPositiveInt(run.awaySeat)) failures.push(`plan run '${run.name}' has invalid awaySeat`);
    if (typeof run.hostLeave !== 'boolean') failures.push(`plan run '${run.name}' has invalid hostLeave`);
    if (!Array.isArray(run.args)) failures.push(`plan run '${run.name}' has invalid args`);
    if (!('fixture' in run) || !('expectedClass' in run)) failures.push(`plan run '${run.name}' is missing fixture or expectedClass`);
    if ((run.fixture === null) !== (run.expectedClass === null)) failures.push(`plan run '${run.name}' fixture and expectedClass must both be null or both be set`);
    if (run.expectedClass !== null && run.expectedClass !== 'qualifying' && run.expectedClass !== 'all-eliminated') failures.push(`plan run '${run.name}' has invalid expectedClass`);
    if (run.fixture !== null) {
      if (typeof run.fixture !== 'string' || run.fixture.length === 0) failures.push(`plan run '${run.name}' has invalid fixture`);
      if (fixtures.has(run.fixture)) failures.push(`plan run '${run.name}' duplicates fixture '${run.fixture}'`);
      fixtures.add(run.fixture);
      const index = run.args.indexOf('--fixture');
      if (index < 0 || run.args[index + 1] !== run.fixture) failures.push(`plan run '${run.name}' args do not name fixture '${run.fixture}' after --fixture`);
      if (run.args.filter((arg) => arg === run.fixture).length !== 1) failures.push(`plan run '${run.name}' names fixture '${run.fixture}' more than once`);
    }
    if (run.expectedClass === 'qualifying' && run.reloadSeat !== null) qualifyingReloads += 1;
    if (run.expectedClass === 'all-eliminated' && run.reloadSeat !== null) allEliminatedReloads += 1;
  }
  if (qualifyingReloads !== 12) failures.push(`plan has ${qualifyingReloads} qualifying reload runs, expected 12`);
  if (allEliminatedReloads !== 1) failures.push(`plan has ${allEliminatedReloads} all-eliminated reload runs, expected 1`);
  for (const step of Array.isArray(plan.suite) ? plan.suite : []) {
    if (!step || typeof step.id !== 'string' || step.id.length === 0) failures.push('plan suite step has no id');
    if (!Array.isArray(step.command) || step.command.length === 0) failures.push(`plan suite step '${step?.id}' has no command`);
  }
  return failures;
}

function checkErrorEntries(entries, players, key) {
  const failures = [];
  if (!Array.isArray(entries)) return [`${key} is not an array`];
  if (entries.length !== players) failures.push(`${key} has ${entries.length} entries, expected ${players}`);
  const seats = new Set();
  for (const entry of entries) {
    if (!entry || !isPositiveInt(entry.seat) || entry.seat < 1 || entry.seat > players) {
      failures.push(`${key} has an invalid seat`);
      continue;
    }
    if (seats.has(entry.seat)) failures.push(`${key} has duplicate seat ${entry.seat}`);
    seats.add(entry.seat);
    if (typeof entry.name !== 'string' || entry.name.trim().length === 0) failures.push(`${key} seat ${entry.seat} has no name`);
    if (!Array.isArray(entry[key])) failures.push(`${key} seat ${entry.seat} has no ${key} array`);
  }
  for (let seat = 1; seat <= players; seat++) if (!seats.has(seat)) failures.push(`${key} is missing seat ${seat}`);
  return failures;
}

export function checkReloadEvidence({ reload, attempts, files, players, reloadSeat }) {
  const failures = [];
  if (!attempts || typeof attempts !== 'object') return ['reload attempts file malformed'];
  if (attempts.classification !== 'stable-match') failures.push(`reload attempts classification is '${attempts.classification}'`);
  if (attempts.classification !== reload.classification) failures.push('reload attempts classification mismatch');
  if (JSON.stringify(attempts.revision) !== JSON.stringify(reload.revision)) failures.push('reload attempts revision mismatch');
  if (JSON.stringify(attempts.seats) !== JSON.stringify(reload.seats)) failures.push('reload attempts seats mismatch');
  if (attempts.rowsCompared !== reload.rowsCompared) failures.push('reload attempts rowsCompared mismatch');
  if (!Array.isArray(attempts.samples) || attempts.samples.length < 1 || attempts.samples.length > 60) failures.push('reload attempts count out of bound');
  else {
    let previous = -1;
    for (let index = 0; index < attempts.samples.length; index++) {
      const sample = attempts.samples[index];
      if (sample?.attempt !== index) failures.push(`reload sample ${index} attempt is not ${index}`);
      if (typeof sample?.ms !== 'number' || !Number.isFinite(sample.ms) || sample.ms < 0) failures.push(`reload sample ${index} ms is not a finite non-negative number`);
      else if (sample.ms < previous) failures.push(`reload sample ${index} ms decreased`);
      else previous = sample.ms;
      if (typeof sample?.recap !== 'boolean') failures.push(`reload sample ${index} recap is not boolean`);
      if (!Array.isArray(sample?.seats)) failures.push(`reload sample ${index} seats is not an array`);
      else {
        const seen = new Set();
        for (const entry of sample.seats) {
          if (!Number.isInteger(entry?.seat) || entry.seat < 1 || entry.seat > players) failures.push(`reload sample ${index} seat ${entry?.seat} is out of range`);
          if (typeof entry?.name !== 'string' || entry.name.length === 0) failures.push(`reload sample ${index} seat ${entry?.seat} name is empty`);
          if (typeof entry?.revision !== 'string') failures.push(`reload sample ${index} seat ${entry?.seat} revision is not a string`);
          if (!Number.isInteger(entry?.rows) || entry.rows < 0) failures.push(`reload sample ${index} seat ${entry?.seat} rows is not a non-negative integer`);
          if (seen.has(entry?.seat)) failures.push(`reload sample ${index} seat ${entry?.seat} is duplicated`);
          seen.add(entry?.seat);
        }
      }
    }
    const last = attempts.samples[attempts.samples.length - 1];
    if (last?.recap !== false) failures.push('reload last sample recap is not false');
    const lastSeats = Array.isArray(last?.seats) ? last.seats : [];
    const expected = seatNumbers(reload.seats);
    if (expected.size < 2) failures.push(`reload.seats has ${expected.size} distinct seats`);
    if (!expected.has(reloadSeat)) failures.push(`reload.seats does not include seat ${reloadSeat}`);
    for (const [number, names] of expected) {
      const name = [...names][0];
      const entry = lastSeats.find((seat) => seat?.seat === number && seat?.name === name);
      if (!entry) failures.push(`reload last sample is missing seat ${number}:${name}`);
      else {
        if (entry.revision !== revisionLabel(reload.revision)) failures.push(`reload last sample seat ${number} revision mismatch`);
        if (!(entry.rows > 0)) failures.push(`reload last sample seat ${number} rows is not positive`);
      }
    }
  }
  const refreshed = reload?.refreshedSeat;
  const others = [...seatNumbers(reload.seats)].map(([number, names]) => ({ seat: number, name: [...names][0] })).filter((seat) => seat.seat !== refreshed?.seat);
  const captures = [refreshed, others[0]].filter(Boolean);
  for (const seat of captures) {
    for (const phase of ['before', 'after']) {
      const base = reloadCaptureBase(phase, seat);
      for (const suffix of ['.png', '.aria.txt']) {
        const size = files.get(`${base}${suffix}`);
        if (!(size > 0)) failures.push(`reload capture ${base}${suffix} is missing or empty`);
      }
    }
  }
  return failures;
}

export function checkNoBoundaryContract({ reload, attempts, stages }) {
  const failures = [];
  if (reload?.classification !== 'no-held-boundary') failures.push(`reload classification is '${reload?.classification}'`);
  if (attempts?.classification !== 'no-held-boundary') failures.push(`attempts classification is '${attempts?.classification}'`);
  if (reload?.reason !== 'no held playoff gate') failures.push(`reload reason is '${reload?.reason}'`);
  if (attempts?.reason !== reload?.reason) failures.push('attempts reason does not match reload reason');
  if (reload?.ran !== false) failures.push('reload.ran is not false');
  if (reload?.armed !== true) failures.push('reload.armed is not true');
  if (reload?.revision !== null) failures.push('reload.revision is not null');
  if (attempts?.revision !== null) failures.push('attempts.revision is not null');
  if (!Array.isArray(reload?.seats) || reload.seats.length !== 0) failures.push('reload.seats is not empty');
  if (!Array.isArray(attempts?.seats) || attempts.seats.length !== 0) failures.push('attempts.seats is not empty');
  if (reload?.rowsCompared !== 0) failures.push('reload.rowsCompared is not 0');
  if (attempts?.rowsCompared !== 0) failures.push('attempts.rowsCompared is not 0');
  if (reload?.refreshedSeat !== null) failures.push('reload.refreshedSeat is not null');
  if (reload?.navigation !== undefined) failures.push('reload.navigation is present');
  if (reload?.session !== undefined) failures.push('reload.session is present');
  if (!Array.isArray(reload?.samples) || reload.samples.length !== 0) failures.push('reload.samples is not empty');
  if (!Array.isArray(attempts?.samples) || attempts.samples.length !== 0) failures.push('attempts.samples is not empty');
  const coverage = refreshCoverage(true, reload);
  if (reload?.coverage !== coverage.reason) failures.push(`reload.coverage is '${reload?.coverage}', expected '${coverage.reason}'`);
  if (coverage.reason !== 'reload classification is no-held-boundary') failures.push(`coverage reason is '${coverage.reason}'`);
  if (reload?.allEliminated !== true) failures.push('reload.allEliminated is not true');
  if (reload?.allEliminatedObserved !== true) failures.push('reload.allEliminatedObserved is not true');
  if ((Array.isArray(stages) ? stages : []).some((stage) => stage?.label === 'after-reload')) failures.push('after-reload stage is present');
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
  if ((meta.awaySeat ?? null) !== (run.awaySeat ?? null)) failures.push(`run.json awaySeat ${meta.awaySeat} != ${run.awaySeat}`);
  if ((meta.hostLeave === true) !== (run.hostLeave === true)) failures.push(`run.json hostLeave ${meta.hostLeave} != ${run.hostLeave}`);
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
  if (summary.players !== run.players) failures.push(`summary players ${summary.players} != ${run.players}`);
  if (summary.mode !== run.mode) failures.push(`summary mode '${summary.mode}' != '${run.mode}'`);
  if (summary.device !== run.device) failures.push(`summary device '${summary.device}' != '${run.device}'`);
  if ((summary.chaos?.reload ?? null) !== (run.reloadSeat ?? null)) failures.push(`summary chaos.reload ${summary.chaos?.reload} != ${run.reloadSeat}`);
  if ((summary.chaos?.away ?? null) !== (run.awaySeat ?? null)) failures.push(`summary chaos.away ${summary.chaos?.away} != ${run.awaySeat}`);
  if ((summary.chaos?.hostLeave === true) !== (run.hostLeave === true)) failures.push(`summary chaos.hostLeave ${summary.chaos?.hostLeave} != ${run.hostLeave}`);
  const stages = Array.isArray(summary.stages) ? summary.stages : [];
  if (run.awaySeat !== null && !stages.some((stage) => stage?.label === 'away' && stage.seat === run.awaySeat)) failures.push(`summary has no away stage for seat ${run.awaySeat}`);
  if (run.hostLeave === true && !stages.some((stage) => stage?.label === 'host-left')) failures.push('summary has no host-left stage');
  failures.push(...checkErrorEntries(summary.errors, run.players, 'errors'));
  failures.push(...checkErrorEntries(summary.httpErrors, run.players, 'responses'));
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
  if (run.fixture !== null) {
    const fixture = summary.fixture;
    if (!fixture || typeof fixture !== 'object') failures.push('summary.fixture is missing');
    else {
      if (fixture.id !== run.fixture) failures.push(`summary.fixture.id '${fixture.id}' != '${run.fixture}'`);
      if (fixture.expectedClass !== run.expectedClass) failures.push(`summary.fixture.expectedClass '${fixture.expectedClass}' != '${run.expectedClass}'`);
      if (fixture.observedClass !== run.expectedClass) failures.push(`summary.fixture.observedClass '${fixture.observedClass}' != '${run.expectedClass}'`);
      if (!Array.isArray(fixture.qualifyingSeats) || fixture.qualifyingSeats.some((seat) => !isPositiveInt(seat) || seat > run.players)) failures.push('summary.fixture.qualifyingSeats is not an in-range seat array');
      if (run.expectedClass === 'qualifying') {
        const gate = fixture.gate;
        const derived = gate && typeof gate === 'object' ? gateReadiness({ players: run.players, hostSeat: 1, reads: gate.read }) : null;
        if (!derived) failures.push('summary.fixture.gate is missing');
        else if (!derived.coherent) failures.push(`fixture gate evidence is not a coherent held gate: ${derived.reason}`);
        else if (gate.coherent !== true || gate.hostSeat !== 1 || gate.qualified !== derived.qualified || JSON.stringify(gate.readySeats) !== JSON.stringify(derived.readySeats) || JSON.stringify(fixture.qualifyingSeats) !== JSON.stringify(derived.readySeats)) failures.push('summary.fixture.gate does not match its recorded read');
      } else if (fixture.gate !== null) failures.push('summary.fixture.gate is present on a no-gate fixture');
    }
  } else if (summary.fixture !== undefined) {
    failures.push('summary.fixture is present on a non-fixture run');
  }
  if (run.reloadSeat !== null) {
    const reload = summary.reload;
    if (run.expectedClass === 'all-eliminated') {
      const attempts = reload?.attempts === 'reload-attempts.json' ? readJson(path.join(path.dirname(summaries[0]), reload.attempts)) : null;
      failures.push(...checkNoBoundaryContract({ reload, attempts, stages }));
      if (!(Array.isArray(summary.marks) ? summary.marks : []).some((mark) => mark?.label === 'recap')) failures.push('recap not reached');
      if (!Array.isArray(summary.fixture?.qualifyingSeats) || summary.fixture.qualifyingSeats.length !== 0) failures.push('summary.fixture.qualifyingSeats is not empty');
      const evidenceDir = path.dirname(summaries[0]);
      const files = new Map(fs.readdirSync(evidenceDir).map((name) => [name, fs.statSync(path.join(evidenceDir, name)).size]));
      const captures = [];
      for (let seat = 1; seat <= run.players; seat++) {
        const names = [...files.keys()].filter((name) => new RegExp(`^${seat}-[^/]+-recap\\.aria\\.txt$`).test(name));
        if (names.length !== 1) failures.push(`recap capture missing for seat ${seat}`);
        else captures.push({ seat, aria: fs.readFileSync(path.join(evidenceDir, names[0]), 'utf8') });
      }
      if (captures.length === run.players) {
        const gateSeen = (Array.isArray(summary.gateWaits) ? summary.gateWaits : []).some((entry) => entry?.stage === 'Playoff gate');
        const derived = recapElimination({ players: run.players, captures, playoffSample: reload?.playoffSample ?? null, gateSeen });
        if (!derived.allEliminated) failures.push(`recap evidence does not prove all-eliminated: ${derived.reason}`);
        else if (JSON.stringify(summary.fixture?.elimination) !== JSON.stringify(derived.record)) failures.push('summary.fixture.elimination does not match the saved recap captures');
      }
      const hasCapture = (seat, phase, suffix) => [...files].some(([name, size]) => name.startsWith(`reload-${phase}-${seat}-`) && name.endsWith(suffix) && size > 0);
      for (const suffix of ['.png', '.aria.txt']) {
        if (!hasCapture(run.reloadSeat, 'before', suffix)) failures.push(`reload before capture for seat ${run.reloadSeat} is missing or empty`);
        if (!hasCapture(run.reloadSeat, 'none', suffix)) failures.push(`reload none capture for seat ${run.reloadSeat} is missing or empty`);
      }
      const otherSeats = [...new Set([...files.keys()].map((name) => { const match = name.match(/^reload-(?:before|none)-(\d+)-/); return match ? Number(match[1]) : null; }).filter((seat) => seat !== null && seat !== run.reloadSeat))];
      const other = otherSeats.find((seat) => ['.png', '.aria.txt'].every((suffix) => hasCapture(seat, 'before', suffix) && hasCapture(seat, 'none', suffix)));
      if (other === undefined) failures.push('no other seat has before and none captures');
      if ([...files.keys()].some((name) => name.startsWith('reload-after-'))) failures.push('reload-after capture is present');
    } else {
      if (reload?.classification !== 'stable-match') failures.push(`reload classification is '${reload?.classification}'`);
      if (!reload || reload.ran !== true) failures.push('reload.ran is not true');
      if (!reload || !isPositiveInt(reload.rowsCompared)) failures.push('reload.rowsCompared is not a positive integer');
      if (!reload || !validRevision(reload.revision)) failures.push('reload.revision is not valid');
      if (!reload || reload.coverage !== 'ok') failures.push(`reload.coverage is '${reload?.coverage}'`);
      if (reload?.refreshedSeat?.seat !== run.reloadSeat) failures.push(`reload.refreshedSeat ${reload?.refreshedSeat?.seat} != ${run.reloadSeat}`);
      const identities = seatNumbers(reload?.seats);
      if (identities.size < 2) failures.push(`reload.seats has ${identities.size} distinct seats`);
      if (!identities.has(run.reloadSeat)) failures.push(`reload.seats does not include seat ${run.reloadSeat}`);
      for (const number of identities.keys()) if (number < 1 || number > run.players) failures.push(`reload.seats has out-of-range seat ${number}`);
      if (reload?.navigation?.observed !== true) failures.push('reload navigation not observed');
      if (reload?.session?.present !== true) failures.push('reload session not persisted');
      if (typeof reload?.attempts !== 'string' || reload.attempts !== 'reload-attempts.json') failures.push(`reload attempts path is '${reload?.attempts}'`);
      else {
        const attempts = readJson(path.join(path.dirname(summaries[0]), reload.attempts));
        const evidenceDir = path.dirname(summaries[0]);
        const files = new Map(fs.readdirSync(evidenceDir).map((name) => [name, fs.statSync(path.join(evidenceDir, name)).size]));
        failures.push(...checkReloadEvidence({ reload, attempts, files, players: run.players, reloadSeat: run.reloadSeat }));
      }
      const after = stages.find((stage) => stage?.label === 'after-reload');
      if (!after) failures.push('summary has no after-reload stage');
      else {
        if (JSON.stringify(after.revision) !== JSON.stringify(reload?.revision)) failures.push('after-reload revision differs from reload.revision');
        if (JSON.stringify(after.seats) !== JSON.stringify(reload?.seats)) failures.push('after-reload seats differ from reload.seats');
        const tables = after.standings;
        if (!Array.isArray(tables) || tables.length === 0) failures.push('after-reload standings are missing');
        else {
          const rows = tables.reduce((sum, table) => sum + (Array.isArray(table) ? table.length : 0), 0);
          if (rows !== reload?.rowsCompared) failures.push(`after-reload rows ${rows} != rowsCompared ${reload?.rowsCompared}`);
          if (tables.some((table) => !Array.isArray(table) || table.some((row) => String(row).trim().length === 0))) failures.push('after-reload standings have a blank row');
        }
      }
    }
  }
  return failures;
}

function checkSuite(step, out) {
  const dir = path.join(out, 'suite', step.id);
  const failures = [];
  const command = readText(path.join(dir, 'command.txt'));
  if (command === null) failures.push('missing command.txt');
  else if (command.trim() !== step.command.join(' ')) failures.push(`command.txt '${command.trim()}' != '${step.command.join(' ')}'`);
  const output = readText(path.join(dir, 'output.log'));
  if (output === null || output.trim().length === 0) failures.push('missing or empty output.log');
  if (!exactZero(path.join(dir, 'exit'))) failures.push('exit is not exactly 0');
  if (step.id === '04-test-local-db' || step.id === '05-e2e-local-db') {
    const receipt = readJson(path.join(dir, 'postgres-receipt.json'));
    if (!receipt) failures.push('missing postgres-receipt.json');
    else if (receipt.ok !== true) failures.push('postgres receipt is not clean');
    else if (!Array.isArray(receipt.services) || !receipt.services.some((service) => service.name === 'postgres' && service.state === 'clean')) failures.push('postgres receipt does not cover a clean postgres service');
    else if (receipt.reason) failures.push('postgres receipt has a failed-start reason');
    failures.push(...checkReport(step, dir));
  }
  return failures;
}

function checkReport(step, dir) {
  const report = readJson(path.join(dir, 'report.json'));
  if (!report) return ['missing or malformed report.json'];
  if (step.id === '05-e2e-local-db') return checkPlaywrightReport(step, report);
  const required = step.required?.files ?? {};
  if (!Object.keys(required).length) return ['plan has no required files'];
  if (!Array.isArray(report.testResults)) return ['report.json has no testResults'];
  const entries = new Map();
  for (const file of report.testResults) {
    const raw = String(file.name ?? '');
    const name = path.isAbsolute(raw) ? path.relative(REPO, raw) : raw;
    const tests = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    entries.set(name, tests.map((test) => ({ name: test.fullName ?? test.title ?? '', status: test.status })));
  }
  const failures = [];
  for (const [file, count] of Object.entries(required)) {
    if (!entries.has(file)) {
      failures.push(`report missing ${file}`);
      continue;
    }
    const tests = entries.get(file);
    if (tests.length !== count) failures.push(`${file} has ${tests.length} tests, expected ${count}`);
    for (const test of tests) {
      if (test.status !== 'passed') failures.push(`${file} ${test.name} is ${test.status}`);
    }
  }
  return failures;
}

function checkPlaywrightReport(step, report) {
  const failures = [];
  const rootDir = report.config?.rootDir;
  if (!rootDir || path.resolve(rootDir) !== path.join(REPO, 'e2e')) return ['report rootDir does not resolve to this repo e2e'];
  const projects = step.required?.projects ?? {};
  if (!Object.keys(projects).length) return ['plan has no required projects'];
  const seen = new Set();
  const counts = new Map();
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const file = path.join('e2e', String(spec.file ?? ''));
      const title = String(spec.title ?? '');
      for (const test of spec.tests ?? []) {
        const project = String(test.projectName ?? '');
        const key = `${file}\u0000${title}\u0000${project}`;
        if (seen.has(key)) failures.push(`duplicate ${file} ${title} ${project}`);
        seen.add(key);
        if (!projects[project]) {
          failures.push(`unexpected project ${project}`);
          continue;
        }
        if (projects[project][file] === undefined) {
          failures.push(`unexpected file ${file} in ${project}`);
          continue;
        }
        const results = Array.isArray(test.results) ? test.results : [];
        if (test.expectedStatus !== 'passed') failures.push(`${file} ${title} ${project} expectedStatus ${test.expectedStatus}`);
        if (test.status !== 'expected') failures.push(`${file} ${title} ${project} status ${test.status}`);
        if (results.length !== 1) failures.push(`${file} ${title} ${project} has ${results.length} results`);
        else if (results[0].status !== 'passed') failures.push(`${file} ${title} ${project} result ${results[0].status}`);
        const countKey = `${project}\u0000${file}`;
        counts.set(countKey, (counts.get(countKey) ?? 0) + 1);
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  for (const [project, files] of Object.entries(projects)) {
    for (const [file, count] of Object.entries(files)) {
      const actual = counts.get(`${project}\u0000${file}`) ?? 0;
      if (actual !== count) failures.push(`${project} ${file} has ${actual} tests, expected ${count}`);
    }
  }
  return failures;
}

function checkLaunch(out, expectedHead) {
  const failures = [];
  const meta = readJson(path.join(out, 'meta.json'));
  const tracked = readJson(path.join(out, 'tracked.json'));
  const launch = readJson(path.join(out, 'launch.json'));
  if (!meta) failures.push('meta.json is missing or malformed');
  if (!tracked) failures.push('tracked.json is missing or malformed');
  if (!launch) failures.push('launch.json is missing or malformed');
  if (!exactZero(path.join(out, 'launch.exit'))) failures.push('launch.exit is not exactly 0');
  if (expectedHead && !isFullSha(expectedHead)) failures.push(`expected head '${expectedHead}' is not a full 40-hex SHA`);
  if (meta && !isFullSha(meta.head)) failures.push(`meta.head '${meta.head}' is not a full 40-hex SHA`);
  if (launch && !isShortSha(launch.head)) failures.push(`launch.head '${launch.head}' is not a lowercase hex SHA of at least 7 characters`);
  if (meta && expectedHead && meta.head !== expectedHead) failures.push(`meta.head '${meta.head}' != '${expectedHead}'`);
  if (launch && expectedHead && isShortSha(launch.head) && !expectedHead.startsWith(launch.head)) failures.push(`launch.head '${launch.head}' is not a prefix of '${expectedHead}'`);
  if (meta && launch && isShortSha(launch.head) && !meta.head.startsWith(launch.head)) failures.push(`meta.head '${meta.head}' does not start with launch.head '${launch.head}'`);
  if (meta && tracked && meta.port !== tracked.port) failures.push('meta.port != tracked.port');
  if (launch && tracked && launch.pid !== tracked.pid) failures.push('launch.pid != tracked.pid');
  if (launch && tracked && launch.port !== tracked.port) failures.push('launch.port != tracked.port');
  if (launch && tracked && (launch.localDb?.pgPort ?? null) !== (tracked.pgPort ?? null)) failures.push('launch.localDb.pgPort != tracked.pgPort');
  if (meta && !isPositiveInt(meta.e2ePort)) failures.push('meta.e2ePort is not a positive integer');
  if (meta && !isPositiveInt(meta.suitePgPort)) failures.push('meta.suitePgPort is not a positive integer');
  return failures;
}

function checkCleanup(out) {
  const failures = [];
  const meta = readJson(path.join(out, 'meta.json'));
  const tracked = readJson(path.join(out, 'tracked.json'));
  if (!meta || !tracked) return ['cleanup: missing meta or tracked record'];
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
  if (isPositiveInt(meta.e2ePort)) expected.set('e2e_port_listening', 'no');
  if (isPositiveInt(meta.suitePgPort)) expected.set('suite_pg_port_listening', 'no');
  expected.set('app_group', 'clean');
  expected.set('postgres', 'clean');
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
    const stepFailures = checkSuite(step, out);
    failures.push(...stepFailures.map((failure) => `suite ${step.id}: ${failure}`));
  }
  failures.push(...checkLaunch(out, expectedHead));
  if (cleanup) failures.push(...checkCleanup(out));
  const refreshProofs = Array.isArray(plan?.runs) ? plan.runs.filter((run) => run.expectedClass === 'qualifying' && run.reloadSeat !== null && rows.find((row) => row.name === run.name)?.failures.length === 0).length : 0;
  if (refreshProofs !== 12) failures.push(`refresh proofs ${refreshProofs} != 12`);
  return { ok: failures.length === 0, rows, failures, refreshProofs };
}

export function runReplayCheck(argv) {
  const self = fileURLToPath(import.meta.url);
  const hash = createHash('sha256').update(fs.readFileSync(self)).digest('hex');
  console.log(`core: ${self} sha256=${hash}`);
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
  console.log(`refreshProofs: ${result.refreshProofs}`);
  if (result.failures.length) {
    console.log('');
    for (const failure of result.failures) console.log(`- ${failure}`);
    console.log(`\nFAIL ${result.failures.length} check(s)`);
    process.exit(1);
  }
  console.log(`\nPASS ${result.rows.length} run(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runReplayCheck(process.argv.slice(2));
