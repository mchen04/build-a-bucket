#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);
const PORT = Number(flag('port', '4395'));
const PG_PORT = Number(flag('pg-port', '55433'));
const PLAYERS = Math.max(2, Math.min(8, Number(flag('players', '2'))));
const OUT = path.resolve(flag('out', path.join(os.homedir(), '.cache', 'verify-build-a-bucket', `league-meter-${new Date().toISOString().replace(/[:.]/g, '-')}`)));
const KEEP = has('keep');
const METER_LOG = path.join(OUT, 'db-meter.jsonl');
const SERVER_LOG = path.join(OUT, 'server.log');
const localDb = await import(pathToFileURL(path.join(REPO, 'scripts/local-db.mjs')).href);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pct = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
};
const sum = (values) => values.reduce((a, b) => a + b, 0);

registerHooks({
  resolve(spec, context, next) {
    if (spec.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const base = fileURLToPath(new URL(spec, context.parentURL));
      if (!fs.existsSync(base)) {
        for (const candidate of [base.replace(/\.js$/, '.ts'), `${base}.ts`]) {
          if (fs.existsSync(candidate)) return { url: pathToFileURL(candidate).href, format: 'module-typescript', shortCircuit: true };
        }
      }
    }
    return next(spec, context);
  },
});

function human(index) {
  return {
    participantId: `meter-${index + 1}`,
    seat: index + 1,
    name: `Meter ${index + 1}`,
    team: ['BOS', 'LAL', 'NYK', 'GSW', 'MIA', 'DEN', 'PHX', 'MIL'][index],
    position: index % 2 === 0 ? 'guard' : 'big',
    ovr: 70 + index * 3,
    values: Object.fromEntries(
      ['jumpShot', 'finishing', 'passing', 'handles', 'perimeterDefense', 'speed', 'bounce', 'size', 'basketballIQ', 'clutch'].map(
        (attr) => [attr, 6 + ((index + attr.length) % 5)],
      ),
    ),
  };
}

async function engineTiming() {
  const { simulateLeague } = await import(pathToFileURL(path.join(REPO, 'src/shared/engine/league.ts')).href);
  const humans = Array.from({ length: PLAYERS }, (_, index) => human(index));
  const ms = [];
  for (let index = 0; index < 5; index++) {
    const started = performance.now();
    simulateLeague({ seed: `meter-engine-${index}`, era: 'current', mode: 'normal', humans });
    ms.push(performance.now() - started);
  }
  return { runs: ms.length, ms, p50: pct(ms, 50), p95: pct(ms, 95), max: Math.round(Math.max(...ms)) };
}

function psql(sql) {
  return execFileSync(
    path.join(process.env.BAB_PG_BIN ?? '/opt/homebrew/bin', 'psql'),
    ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'postgres', '-d', 'bab_meter', '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { encoding: 'utf8' },
  );
}

async function startServer() {
  const out = fs.openSync(SERVER_LOG, 'w');
  const env = {
    ...process.env,
    DATABASE_URL: `postgres://postgres@127.0.0.1:${PG_PORT}/bab_meter`,
    BAB_DB_RUNNER: path.join(HERE, 'local-pg.mjs'),
    BAB_DB_METER_LOG: METER_LOG,
    BAB_PG_HOST: '127.0.0.1',
    BAB_PG_PORT: String(PG_PORT),
    BAB_PG_DATABASE: 'bab_meter',
    BAB_PG_USER: 'postgres',
  };
  const child = spawn(process.execPath, [path.join(REPO, 'scripts/dev-server.ts'), '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], {
    cwd: REPO,
    env,
    stdio: ['ignore', out, out],
  });
  const base = `http://127.0.0.1:${PORT}`;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/lobby/ZZZZZZ`, {
        headers: { authorization: `Bearer ${'0'.repeat(32)}` },
        signal: AbortSignal.timeout(3000),
      });
      if (response.status < 500) return { child, base };
    } catch {
      await sleep(400);
    }
  }
  throw new Error(`server did not become ready; see ${SERVER_LOG}`);
}

async function stopServer(server) {
  if (!server) return;
  server.child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.child.kill('SIGKILL');
      resolve();
    }, 5000);
    server.child.once('exit', () => {
      globalThis.clearTimeout(timer);
      resolve();
    });
  });
}

const calls = [];

async function call(base, name, method, route, secret, body) {
  const started = Date.now();
  const response = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  const ended = Date.now();
  const record = { name, method, path: route.replace(/\/api\/lobby\/[A-Z0-9]{6}/, '/api/lobby/:code'), status: response.status, ms: ended - started, started, ended, json: null };
  if (text) {
    try {
      record.json = JSON.parse(text);
    } catch {
      record.json = text.slice(0, 200);
    }
  }
  calls.push(record);
  if (response.status >= 400) throw new Error(`${name} ${response.status} ${text.slice(0, 300)}`);
  return record;
}

function absorb(seat, record) {
  const lobby = record.json?.lobby;
  const delta = record.json?.delta;
  if (lobby) {
    seat.version = lobby.version;
    seat.seat = lobby.me?.seat ?? seat.seat;
    seat.events = lobby.events[0]?.id ?? 0;
    seat.participants = lobby.participants;
    seat.waiting = lobby.league?.checkpoint === true || ['lobby', 'draw', 'building', 'preview', 'rematch', 'recap'].includes(lobby.phase);
    seat.cursor = lobby.league?.cursor ?? seat.cursor;
    seat.stage = lobby.stage ?? seat.stage;
    seat.code = lobby.code ?? seat.code;
  } else if (delta) {
    seat.version = delta.version;
    seat.events = Math.max(seat.events, delta.events?.[0]?.id ?? 0);
    seat.cursor = delta.league?.stageCursor ?? seat.cursor;
    seat.stage = delta.league?.stage ?? seat.stage;
  }
}

function newSeat() {
  return { secret: randomBytes(16).toString('hex'), version: 0, events: 0, waiting: false };
}

async function poll(base, code, seat, name) {
  const query = new URLSearchParams({ since: String(seat.version), events: String(seat.events) });
  if (seat.waiting) query.set('waiting', '1');
  if (seat.cursor !== undefined) query.set('cursor', String(seat.cursor));
  if (seat.stage !== undefined) query.set('stage', String(seat.stage));
  const record = await call(base, name, 'GET', `/api/lobby/${code}?${query.toString()}`, seat.secret);
  absorb(seat, record);
  return record;
}

async function act(base, code, seat, action, name, body = {}) {
  const record = await call(base, name, 'POST', `/api/lobby/${code}/${action}`, seat.secret, { actionId: randomUUID(), ...body });
  absorb(seat, record);
  return record;
}

function readMeter() {
  if (!fs.existsSync(METER_LOG)) return [];
  return fs
    .readFileSync(METER_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function attribute(entries) {
  for (const record of calls) {
    const owned = entries.filter((entry) => entry.t >= record.started && entry.t <= record.ended + 50);
    record.dbRequests = owned.length;
    record.dbMs = Math.round(sum(owned.map((entry) => entry.ms)) * 10) / 10;
  }
}

function endpointSummary() {
  const groups = new Map();
  for (const record of calls) {
    const group = groups.get(record.name) ?? { name: record.name, method: record.method, path: record.path, ms: [], dbRequests: [], dbMs: [], status: {} };
    group.ms.push(record.ms);
    group.dbRequests.push(record.dbRequests ?? 0);
    group.dbMs.push(record.dbMs ?? 0);
    group.status[record.status] = (group.status[record.status] ?? 0) + 1;
    groups.set(record.name, group);
  }
  return [...groups.values()].map((group) => ({
    name: group.name,
    method: group.method,
    path: group.path,
    count: group.ms.length,
    p50: pct(group.ms, 50),
    p95: pct(group.ms, 95),
    max: Math.round(Math.max(...group.ms)),
    dbRequests: sum(group.dbRequests),
    dbMs: Math.round(sum(group.dbMs) * 10) / 10,
    status: group.status,
  }));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const local = await localDb.startLocalDb({
    root: REPO,
    dataDir: path.join(OUT, 'pgdata'),
    pgPort: PG_PORT,
    database: 'bab_meter',
    remove: !KEEP,
  });
  psql('select 1');
  const engine = await engineTiming();
  let server = null;
  try {
    server = await startServer();
    const base = server.base;
    const settings = { era: 'current', mode: 'normal' };
    const host = newSeat();
    const created = await call(base, 'create', 'POST', '/api/lobby', host.secret, { name: 'Host', actionId: randomUUID(), settings });
    absorb(host, created);
    const code = created.json.lobby.code;
    const seats = [host];
    for (let index = 2; index <= PLAYERS; index++) {
      const seat = newSeat();
      absorb(seat, await call(base, 'join', 'POST', `/api/lobby/${code}/join`, seat.secret, { name: `P${index}`, actionId: randomUUID() }));
      seats.push(seat);
    }
    await act(base, code, host, 'start', 'start', { settings });
    await act(base, code, host, 'advance', 'advance-lock', { stage: 0 });
    await act(base, code, host, 'lock', 'lock');
    await poll(base, code, seats[1], 'poll-preview');
    await act(base, code, seats[0], 'ready', 'ready-preview', { stage: 0 });
    const simulation = await act(base, code, seats[1], 'ready', 'ready-season-start', { stage: 0 });
    await poll(base, code, seats[0], 'poll-season');
    psql(`update lobbies set stage_started_at = now() - interval '1 hour', stage_cursor = 100000 where code = '${code}'`);
    await poll(base, code, seats[0], 'poll-season-end');
    const checkpointStage = seats[0].stage;
    await act(base, code, seats[0], 'ready', 'ready-awards', { stage: checkpointStage });
    await poll(base, code, seats[0], 'poll-awards');
    await act(base, code, seats[0], 'advance', 'advance-awards', { stage: checkpointStage });
    await sleep(800);
    const entries = readMeter();
    attribute(entries);
    const result = {
      base,
      players: PLAYERS,
      code,
      engineSimulation: engine,
      simulationRequest: { name: simulation.name, ms: simulation.ms, dbRequests: simulation.dbRequests, dbMs: simulation.dbMs },
      requests: calls.map((record) => ({
        name: record.name,
        method: record.method,
        path: record.path,
        status: record.status,
        ms: record.ms,
        dbRequests: record.dbRequests,
        dbMs: record.dbMs,
      })),
      endpoints: endpointSummary(),
      dbLog: METER_LOG,
      serverLog: SERVER_LOG,
      out: OUT,
    };
    fs.writeFileSync(path.join(OUT, 'league-meter.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await stopServer(server);
    if (!KEEP) await localDb.stopLocalDb(local);
  }
}

await main();
