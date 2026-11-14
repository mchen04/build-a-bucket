import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const PG_BIN = process.env.BAB_PG_BIN ?? '/opt/homebrew/bin';
const PG_PORT = Number(flag('pg-port', '55432'));
const PORT = Number(flag('port', '4393'));
const RUNS = Number(flag('runs', '3'));
const SECONDS = Number(flag('seconds', '20'));
const MODES = flag('modes', 'normal,salary,squad').split(',');
const JOURNEYS = flag('journeys', 'solo,idle,league').split(',');
const TAG = flag('tag', 'branch');
const OUT = path.resolve(flag('out', path.join(REPO, 'evidence', 'perf')));
const SCHEMA = path.resolve(flag('schema', path.join(REPO, 'db/schema.sql')));
const REPO_DIR = path.resolve(flag('repo', REPO));
const KEEP = has('keep');
const LEGACY_SETTINGS = has('legacy-settings');

const DATA = path.join(OUT, 'pgdata');
const LOG = path.join(OUT, 'db-meter.jsonl');
const SERVER_LOG = path.join(OUT, 'server.log');
const apiCalls = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pct = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
};
const median = (values) => pct(values, 50);
const sum = (values) => values.reduce((a, b) => a + b, 0);

function psql(sql, database = 'bab_perf') {
  return execFileSync(path.join(PG_BIN, 'psql'), ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], { encoding: 'utf8' });
}

function pgCtl(args) {
  return execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', DATA, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function startPostgres() {
  fs.mkdirSync(OUT, { recursive: true });
  if (!fs.existsSync(path.join(DATA, 'PG_VERSION'))) {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', DATA, '-A', 'trust', '-U', 'postgres', '--no-sync'], { stdio: 'ignore' });
  }
  try {
    pgCtl(['status']);
  } catch {
    pgCtl(['-l', path.join(OUT, 'pg.log'), '-o', `-p ${PG_PORT} -k /tmp -c listen_addresses=127.0.0.1 -c fsync=off -c full_page_writes=off -c synchronous_commit=off -c max_connections=100`, '-w', 'start']);
  }
  psql('drop database if exists bab_perf', 'postgres');
  psql('create database bab_perf', 'postgres');
  execFileSync(path.join(PG_BIN, 'psql'), ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'postgres', '-d', 'bab_perf', '-v', 'ON_ERROR_STOP=1', '-q', '-f', SCHEMA], { stdio: 'ignore' });
}

function stopPostgres() {
  try {
    pgCtl(['-m', 'fast', '-w', 'stop']);
  } catch {
    return;
  }
}

async function startServer() {
  fs.writeFileSync(LOG, '');
  const env = {
    ...process.env,
    DATABASE_URL: `postgres://postgres@127.0.0.1:${PG_PORT}/bab_perf`,
    BAB_DB_RUNNER: path.join(HERE, 'local-pg.mjs'),
    BAB_DB_METER_LOG: LOG,
    BAB_PG_PORT: String(PG_PORT),
    BAB_PG_DATABASE: 'bab_perf',
    BAB_PG_USER: 'postgres',
    BAB_PG_HOST: '127.0.0.1',
  };
  const out = fs.openSync(SERVER_LOG, 'w');
  const child = spawn(process.execPath, [path.join(REPO_DIR, 'scripts/dev-server.ts'), '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { cwd: REPO_DIR, env, stdio: ['ignore', out, out] });
  const base = `http://127.0.0.1:${PORT}`;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/lobby/ZZZZZZ`, { headers: { authorization: `Bearer ${'0'.repeat(32)}` }, signal: AbortSignal.timeout(3000) });
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

function seat() {
  return { secret: randomBytes(16).toString('hex'), version: 0, events: 0, token: '', participants: [], waiting: false, statuses: {} };
}

async function api(base, method, route, secret, body) {
  const started = performance.now();
  const response = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  const result = { ms: performance.now() - started, status: response.status, bytes: Buffer.byteLength(text, 'utf8'), json: text ? JSON.parse(text) : null };
  apiCalls.push({ t: Date.now(), ms: result.ms, bytes: result.bytes });
  return result;
}

function absorb(target, result) {
  const lobby = result.json?.lobby;
  const delta = result.json?.delta;
  if (lobby) {
    target.version = lobby.version;
    target.events = lobby.events[0]?.id ?? 0;
    target.participants = lobby.participants;
    target.waiting = lobby.league?.checkpoint === true || ['lobby', 'draw', 'building', 'preview', 'rematch', 'recap'].includes(lobby.phase);
  } else if (delta) {
    target.version = delta.version;
    target.events = Math.max(target.events, delta.events[0]?.id ?? 0);
    const bySeat = new Map(target.participants.map((entry) => [entry.seat, entry]));
    for (const entry of delta.participants) bySeat.set(entry.seat, { ...bySeat.get(entry.seat), ...entry });
    target.participants = [...bySeat.values()].sort((a, b) => a.seat - b.seat);
  }
  const away = target.participants.filter((entry) => entry.away).map((entry) => entry.seat).join(',');
  const filled = target.participants.reduce((total, entry) => total + (entry.summary?.filled ?? 0), 0);
  const teams = target.participants.map((entry) => `${entry.seat}:${entry.team ?? ''}:${entry.ready ? 1 : 0}`).join(',');
  target.token = `${target.events}:${away}:${filled}:${teams}`;
}

async function poll(base, code, target, since = target.version) {
  const query = new URLSearchParams({ since: String(since), events: String(target.events) });
  if (target.token) query.set('token', target.token);
  if (target.waiting) query.set('waiting', '1');
  const result = await api(base, 'GET', `/api/lobby/${code}?${query.toString()}`, target.secret);
  const kind = result.status === 204 ? '204' : result.json?.delta ? 'delta' : 'full';
  target.statuses[kind] = (target.statuses[kind] ?? 0) + 1;
  absorb(target, result);
  return { ...result, kind };
}

async function pollAll(base, code, seats, rounds, gap) {
  const results = [];
  for (let round = 0; round < rounds; round++) {
    results.push(...(await Promise.all(seats.map((entry) => poll(base, code, entry)))));
    if (round + 1 < rounds) await sleep(gap);
  }
  return results;
}

async function createLobby(base, name, settings) {
  const host = seat();
  const body = LEGACY_SETTINGS ? { era: 'current', mode: 'normal', positions: ['guard', 'big'], revealSeconds: 4 } : settings;
  const created = await api(base, 'POST', '/api/lobby', host.secret, { name, actionId: randomUUID(), settings: body });
  if (created.status >= 300) throw new Error(`create ${created.status} ${JSON.stringify(created.json)}`);
  absorb(host, created);
  return { code: created.json.lobby.code, host, seats: [host] };
}

async function joinSeats(base, code, seats, count) {
  for (let index = seats.length + 1; index <= count; index++) {
    const guest = seat();
    const joined = await api(base, 'POST', `/api/lobby/${code}/join`, guest.secret, { name: `P${index}`, actionId: randomUUID() });
    if (joined.status >= 300) throw new Error(`join ${joined.status} ${JSON.stringify(joined.json)}`);
    absorb(guest, joined);
    seats.push(guest);
  }
}

async function act(base, code, target, action, body = {}) {
  const result = await api(base, 'POST', `/api/lobby/${code}/${action}`, target.secret, { actionId: randomUUID(), ...body });
  if (result.status >= 300) throw new Error(`${action} ${result.status} ${JSON.stringify(result.json)}`);
  absorb(target, result);
  return result;
}

function fastForward(code) {
  psql(`update lobbies set stage_started_at = now() - interval '1 hour', stage_cursor = 100000 where code = '${code}'`);
}

async function idleJourney(base, seconds) {
  const { code, seats } = await createLobby(base, 'Idle0', { era: 'current', mode: 'normal' });
  await joinSeats(base, code, seats, 8);
  const pollFrom = readMeter().length;
  const stopAt = Date.now() + seconds * 1000;
  const polls = [];
  await Promise.all(seats.map(async (entry) => {
    while (Date.now() < stopAt) {
      polls.push(await poll(base, code, entry));
      await sleep(1000);
    }
  }));
  return { code, seats: seats.length, seconds, polls: polls.length, pollFrom, statuses: seats.reduce((acc, entry) => { for (const [kind, count] of Object.entries(entry.statuses)) acc[kind] = (acc[kind] ?? 0) + count; return acc; }, {}) };
}

async function waitJourney(base, mode, phase, seconds) {
  const settings = { era: 'current', mode };
  const { code, host, seats } = await createLobby(base, 'Host', settings);
  await joinSeats(base, code, seats, 8);
  await act(base, code, host, 'start', { settings });
  await Promise.all(seats.map((entry) => act(base, code, entry, 'draw')));
  await act(base, code, host, 'lock');
  await act(base, code, host, 'advance', { stage: 0 });
  if (phase === 'building') {
    await act(base, code, seats[1], 'ready', { stage: 0 });
  } else {
    await Promise.all(seats.map((entry) => act(base, code, entry, 'ready', { stage: 0 })));
    await poll(base, code, host);
    if (phase === 'checkpoint') {
      fastForward(code);
      await Promise.all(seats.map((entry) => poll(base, code, entry, 0)));
    }
  }
  const pollFrom = readMeter().length;
  const stopAt = Date.now() + seconds * 1000;
  const polls = [];
  await Promise.all(seats.map(async (entry) => {
    while (Date.now() < stopAt) {
      polls.push(await poll(base, code, entry));
      await sleep(1000);
    }
  }));
  const statuses = seats.reduce((acc, entry) => {
    for (const [kind, count] of Object.entries(entry.statuses)) acc[kind] = (acc[kind] ?? 0) + count;
    return acc;
  }, {});
  return { code, mode, phase, seats: seats.length, seconds, polls: polls.length, pollFrom, statuses };
}

async function freshnessJourney(base) {
  const settings = { era: 'current', mode: 'normal' };
  const { code, host, seats } = await createLobby(base, 'Host', settings);
  await joinSeats(base, code, seats, 8);
  const latencies = [];
  const watch = async (watcher, started, seen) => {
    while (Date.now() - started < 5000) {
      const result = await poll(base, code, watcher);
      const view = result.json?.lobby ?? null;
      const delta = result.json?.delta ?? null;
      if (seen(view, delta)) return Date.now() - started;
      await sleep(1000);
    }
    return null;
  };
  for (const actor of seats) {
    const started = Date.now();
    const watches = seats
      .filter((entry) => entry !== actor)
      .map((watcher) => watch(watcher, started, (view, delta) => {
        const entry = view?.participants?.find((candidate) => candidate.seat === actor.seat)
          ?? delta?.participants?.find((candidate) => candidate.seat === actor.seat);
        return entry?.ready === true;
      }));
    await act(base, code, actor, 'ready', { stage: 0 });
    latencies.push(...(await Promise.all(watches)).filter((value) => value !== null));
  }
  await act(base, code, host, 'start', { settings });
  await Promise.all(seats.map((entry) => act(base, code, entry, 'draw')));
  await act(base, code, host, 'lock');
  await act(base, code, host, 'advance', { stage: 0 });
  await Promise.all(seats.map((entry) => act(base, code, entry, 'ready', { stage: 0 })));
  const seasonStart = Date.now();
  const seasonWatches = seats.map((watcher) => watch(watcher, seasonStart, (view) => view?.phase === 'season'));
  await poll(base, code, host);
  latencies.push(...(await Promise.all(seasonWatches)).filter((value) => value !== null));
  const before = await poll(base, code, seats[0], 0);
  const baseVersion = before.json?.lobby?.version ?? 0;
  await sleep(1400);
  const revealStart = Date.now();
  const revealWatches = seats.map((watcher) => watch(watcher, revealStart, (view) => (view?.version ?? 0) > baseVersion));
  latencies.push(...(await Promise.all(revealWatches)).filter((value) => value !== null));
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    seats: seats.length,
    samples: latencies.length,
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? null,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? null,
    max: sorted[sorted.length - 1] ?? null,
  };
}

async function leagueJourney(base, mode, options) {
  const settings = { era: 'current', mode };
  const { code, host, seats } = await createLobby(base, 'Host', settings);
  await joinSeats(base, code, seats, 8);
  await act(base, code, host, 'start', { settings });
  await Promise.all(seats.map((entry) => act(base, code, entry, 'draw')));
  await act(base, code, host, 'lock');
  await act(base, code, host, 'advance', { stage: 0 });
  await Promise.all(seats.map((entry) => act(base, code, entry, 'ready', { stage: 0 })));
  let lastView = (await poll(base, code, host, 0)).json?.lobby;

  let reconnect = null;
  let polls = 0;
  let stages = 0;
  for (let guard = 0; guard < 40; guard++) {
    const incremental = await poll(base, code, seats[0]);
    if (incremental.json?.lobby) lastView = incremental.json.lobby;
    const current = lastView;
    if (!current) throw new Error(`league view missing for ${mode}: incremental=${incremental.status} body=${JSON.stringify(incremental.json)?.slice(0, 300)}`);
    polls += 1;
    if (current.phase === 'recap') break;
    const results = await pollAll(base, code, seats, 2, 800);
    polls += results.length;
    if (current.stage === 2 && options.reconnect && !reconnect) {
      const target = seats[3];
      const reload = await poll(base, code, target, 0);
      reconnect = { seat: 4, since: 0, versionBefore: target.version, status: reload.status, bytes: reload.bytes, kind: reload.kind };
    }
    fastForward(code);
    await Promise.all(seats.map((entry) => poll(base, code, entry, 0)));
    await Promise.all(seats.map((entry) => act(base, code, entry, 'ready', { stage: current.stage })));
    stages += 1;
  }
  const recap = await poll(base, code, seats[0], 0);
  const champion = recap.json?.lobby?.league?.recap?.champion ?? null;
  if (!champion) throw new Error(`no champion at recap for ${mode}`);

  let rematch = null;
  if (options.rematch) {
    const started = Date.now();
    await act(base, code, host, 'rematch');
    await Promise.all(seats.map((entry) => act(base, code, entry, 'ready', { stage: 0 })));
    await poll(base, code, host);
    await Promise.all(seats.map((entry) => act(base, code, entry, 'draw')));
    await act(base, code, host, 'lock');
    await act(base, code, host, 'advance', { stage: 0 });
    await Promise.all(seats.map((entry) => act(base, code, entry, 'ready', { stage: 0 })));
    const second = [await poll(base, code, seats[0], 0)];
    const view = second[0].json?.lobby;
    rematch = { ms: Date.now() - started, phase: view?.phase ?? null, stage: view?.stage ?? null, polls: second.length };
    if (view?.phase !== 'season' || Number(view?.stage) !== 0) throw new Error(`rematch did not start a second season: ${view?.phase}/${view?.stage}`);
  }
  return { code, mode, seats: seats.length, polls, stages, champion: champion?.team ?? champion, reconnect, rematch };
}

async function staticPayload(base) {
  const index = await fetch(`${base}/`, { headers: { 'accept-encoding': 'identity' } });
  const html = await index.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  let bytes = Buffer.byteLength(html, 'utf8');
  const files = [{ path: '/', bytes: bytes }];
  for (const asset of assets) {
    const response = await fetch(base + asset, { headers: { 'accept-encoding': 'identity' } });
    const body = Buffer.from(await response.arrayBuffer());
    bytes += body.length;
    files.push({ path: asset, bytes: body.length });
  }
  return { bytes, files };
}

function readMeter() {
  if (!fs.existsSync(LOG)) return [];
  return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function windowStats(entries) {
  const ms = entries.map((entry) => entry.ms);
  return {
    requests: entries.length,
    requestBytes: sum(entries.map((entry) => entry.requestBytes)),
    responseBytes: sum(entries.map((entry) => entry.responseBytes)),
    rows: sum(entries.map((entry) => entry.rows)),
    p50: median(ms),
    p95: pct(ms, 95),
    max: ms.length ? Math.round(Math.max(...ms)) : null,
  };
}

function apiStats(results) {
  const ms = results.map((entry) => entry.ms);
  return {
    requests: results.length,
    bytes: sum(results.map((entry) => entry.bytes)),
    p50: median(ms),
    p95: pct(ms, 95),
    max: ms.length ? Math.round(Math.max(...ms)) : null,
  };
}

async function runOnce(base, runIndex) {
  const journeys = [];
  const meterStart = readMeter().length;
  const windows = [];

  if (JOURNEYS.includes('solo')) {
    const started = Date.now();
    const before = readMeter().length;
    const apiBefore = apiCalls.length;
    const page = await fetch(`${base}/`);
    await page.text();
    const after = readMeter().length;
    windows.push({ name: 'solo', started, ended: Date.now(), apiFrom: apiBefore, apiTo: apiCalls.length, dbFrom: before, dbTo: after, note: 'static page only; Play and Daily run in the browser' });
  }

  if (JOURNEYS.includes('idle')) {
    const started = Date.now();
    const before = readMeter().length;
    const apiBefore = apiCalls.length;
    const result = await idleJourney(base, SECONDS);
    windows.push({ name: 'idle-lobby', started, ended: Date.now(), apiFrom: apiBefore, apiTo: apiCalls.length, dbFrom: before, dbTo: readMeter().length, detail: result });
  }

  if (JOURNEYS.includes('wait')) {
    for (const [phase, mode] of [['building', 'normal'], ['checkpoint', 'normal'], ['reveal', 'normal']]) {
      const started = Date.now();
      const before = readMeter().length;
      const apiBefore = apiCalls.length;
      const result = await waitJourney(base, mode, phase, SECONDS);
      windows.push({ name: `wait-${phase}`, started, ended: Date.now(), apiFrom: apiBefore, apiTo: apiCalls.length, dbFrom: before, dbTo: readMeter().length, detail: result });
    }
  }

  if (JOURNEYS.includes('freshness')) {
    const started = Date.now();
    const before = readMeter().length;
    const apiBefore = apiCalls.length;
    const result = await freshnessJourney(base);
    windows.push({ name: 'freshness', started, ended: Date.now(), apiFrom: apiBefore, apiTo: apiCalls.length, dbFrom: before, dbTo: readMeter().length, detail: result });
  }

  if (JOURNEYS.includes('league')) {
    for (const mode of MODES) {
      const started = Date.now();
      const before = readMeter().length;
      const apiBefore = apiCalls.length;
      const result = await leagueJourney(base, mode, { reconnect: true, rematch: true });
      windows.push({ name: `league-${mode}`, started, ended: Date.now(), apiFrom: apiBefore, apiTo: apiCalls.length, dbFrom: before, dbTo: readMeter().length, detail: result });
    }
  }

  await sleep(600);
  const meter = readMeter();
  for (const window of windows) {
    const entries = meter.slice(window.dbFrom, window.dbTo).filter((entry) => !entry.sql.startsWith('/*harness*/'));
    window.db = windowStats(entries);
    if (window.detail?.pollFrom !== undefined) {
      window.poll = windowStats(meter.slice(window.detail.pollFrom, window.dbTo).filter((entry) => !entry.sql.startsWith('/*harness*/')));
    }
    window.api = apiStats(apiCalls.slice(window.apiFrom, window.apiTo));
    delete window.dbFrom;
    delete window.dbTo;
    delete window.apiFrom;
    delete window.apiTo;
    journeys.push(window);
  }
  return { run: runIndex, journeys, meterEntries: meter.length - meterStart };
}

function aggregate(runs) {
  const byName = new Map();
  for (const run of runs) {
    for (const journey of run.journeys) {
      if (!byName.has(journey.name)) byName.set(journey.name, []);
      byName.get(journey.name).push(journey);
    }
  }
  const out = {};
  for (const [name, list] of byName) {
    const pick = (fn) => list.map(fn);
    const polls = (entry) => entry.detail?.polls ?? entry.api.requests ?? 1;
    out[name] = {
      runs: list.length,
      dbRequests: { median: median(pick((entry) => entry.db.requests)), range: [Math.min(...pick((entry) => entry.db.requests)), Math.max(...pick((entry) => entry.db.requests))] },
      dbRequestBytes: { median: median(pick((entry) => entry.db.requestBytes)), range: [Math.min(...pick((entry) => entry.db.requestBytes)), Math.max(...pick((entry) => entry.db.requestBytes))] },
      dbResponseBytes: { median: median(pick((entry) => entry.db.responseBytes)), range: [Math.min(...pick((entry) => entry.db.responseBytes)), Math.max(...pick((entry) => entry.db.responseBytes))] },
      dbP50: { median: median(pick((entry) => entry.db.p50)), range: [Math.min(...pick((entry) => entry.db.p50)), Math.max(...pick((entry) => entry.db.p50))] },
      dbP95: { median: median(pick((entry) => entry.db.p95)), range: [Math.min(...pick((entry) => entry.db.p95)), Math.max(...pick((entry) => entry.db.p95))] },
      dbMax: { median: median(pick((entry) => entry.db.max)), range: [Math.min(...pick((entry) => entry.db.max)), Math.max(...pick((entry) => entry.db.max))] },
      dbBytesPerPoll: { median: median(pick((entry) => Math.round(entry.db.responseBytes / polls(entry)))), range: [Math.min(...pick((entry) => Math.round(entry.db.responseBytes / polls(entry)))), Math.max(...pick((entry) => Math.round(entry.db.responseBytes / polls(entry))))] },
      dbBytesPerSeatMinute: {
        median: median(pick((entry) => (entry.detail?.seats && entry.detail?.seconds ? Math.round(entry.db.responseBytes / ((entry.detail.seats * entry.detail.seconds) / 60)) : 0))),
        range: [
          Math.min(...pick((entry) => (entry.detail?.seats && entry.detail?.seconds ? Math.round(entry.db.responseBytes / ((entry.detail.seats * entry.detail.seconds) / 60)) : 0))),
          Math.max(...pick((entry) => (entry.detail?.seats && entry.detail?.seconds ? Math.round(entry.db.responseBytes / ((entry.detail.seats * entry.detail.seconds) / 60)) : 0))),
        ],
      },
      dbBytesPerSeatMinuteSteady: {
        median: median(pick((entry) => (entry.detail?.seats && entry.detail?.seconds && entry.poll ? Math.round(entry.poll.responseBytes / ((entry.detail.seats * entry.detail.seconds) / 60)) : 0))),
        range: [
          Math.min(...pick((entry) => (entry.detail?.seats && entry.detail?.seconds && entry.poll ? Math.round(entry.poll.responseBytes / ((entry.detail.seats * entry.detail.seconds) / 60)) : 0))),
          Math.max(...pick((entry) => (entry.detail?.seats && entry.detail?.seconds && entry.poll ? Math.round(entry.poll.responseBytes / ((entry.detail.seats * entry.detail.seconds) / 60)) : 0))),
        ],
      },
      apiRequests: { median: median(pick((entry) => entry.api.requests)), range: [Math.min(...pick((entry) => entry.api.requests)), Math.max(...pick((entry) => entry.api.requests))] },
      apiBytes: { median: median(pick((entry) => entry.api.bytes)), range: [Math.min(...pick((entry) => entry.api.bytes)), Math.max(...pick((entry) => entry.api.bytes))] },
      apiP50: { median: median(pick((entry) => entry.api.p50)), range: [Math.min(...pick((entry) => entry.api.p50)), Math.max(...pick((entry) => entry.api.p50))] },
      apiP95: { median: median(pick((entry) => entry.api.p95)), range: [Math.min(...pick((entry) => entry.api.p95)), Math.max(...pick((entry) => entry.api.p95))] },
      detail: list.map((entry) => entry.detail ?? null),
    };
  }
  return out;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const started = Date.now();
  await startPostgres();
  let server = null;
  const runs = [];
  try {
    server = await startServer();
    const staticInfo = await staticPayload(server.base);
    for (let index = 1; index <= RUNS; index++) {
      const result = await runOnce(server.base, index);
      runs.push(result);
      console.log(`run ${index}/${RUNS}: ${result.journeys.map((entry) => `${entry.name} db=${entry.db.requests}/${entry.db.responseBytes}B`).join(' ')}`);
    }
    const summary = { tag: TAG, repo: REPO_DIR, schema: SCHEMA, runs: RUNS, seconds: SECONDS, modes: MODES, journeys: JOURNEYS, static: staticInfo, aggregate: aggregate(runs), raw: runs, elapsedMs: Date.now() - started };
    const file = path.join(OUT, `meter-${TAG}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ file, aggregate: summary.aggregate }, null, 2));
    process.exitCode = 0;
  } finally {
    await stopServer(server);
    if (!KEEP) stopPostgres();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).then(() => {
  process.exit(process.exitCode ?? 0);
});
