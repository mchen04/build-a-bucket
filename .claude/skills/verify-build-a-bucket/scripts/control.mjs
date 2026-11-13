#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(path.join(repo, 'package.json'));
const home = process.env.BAB_VERIFY_HOME ?? path.join(os.homedir(), '.cache', 'verify-build-a-bucket');
const [cmd, ...rest] = process.argv.slice(2);

function opts(list) {
  const out = { _: [], step: [] };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = list[i + 1];
    const value = next === undefined || next.startsWith('--') ? true : (i++, next);
    if (key === 'step') out.step.push(value); else out[key] = value;
  }
  return out;
}
const o = opts(rest);

function currentRun() {
  const pointer = path.join(home, 'current');
  if (!fs.existsSync(pointer)) throw new Error('no run: start one with `control.mjs launch`');
  const dir = fs.readFileSync(pointer, 'utf8').trim();
  return { dir, state: JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')) };
}
function saveState(dir, state) { fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(state, null, 2)); }
function evidenceDir(dir, sub = '') { const d = path.join(dir, 'evidence', sub); fs.mkdirSync(d, { recursive: true }); return d; }
function baseUrl() { return o.base ?? currentRun().state.base; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]); };
const median = (arr) => pct(arr, 50);
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function portOwner(port) { try { return execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number); } catch { return []; } }
function descendants(pid) { try { const kids = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number); return kids.flatMap((k) => [k, ...descendants(k)]); } catch { return []; } }

async function probe(base) {
  const out = { base };
  try { const r = await fetch(base + '/', { signal: AbortSignal.timeout(10000) }); const t = await r.text(); out.app = r.status; out.appIdentity = /<title>[^<]*<\/title>/.exec(t)?.[0] ?? null; } catch (e) { out.app = String(e.message); }
  try { const r = await fetch(base + '/api/lobby/ZZZZZZ?since=0', { headers: { authorization: `Bearer ${'0'.repeat(32)}` }, signal: AbortSignal.timeout(15000) }); out.api = r.status; out.apiBody = (await r.text()).slice(0, 160); } catch (e) { out.api = String(e.message); }
  out.ready = out.app === 200 && out.api === 404;
  return out;
}

async function launch() {
  const port = Number(o.port ?? 4300 + Math.floor(Math.random() * 500));
  if (portOwner(port).length) throw new Error(`port ${port} is taken; pass --port`);
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(home, id);
  fs.mkdirSync(evidenceDir(dir), { recursive: true });
  const mode = o.prod ? 'prod' : 'dev';
  let child;
  const log = fs.openSync(path.join(dir, 'server.log'), 'a');
  if (mode === 'prod') {
    execFileSync('npm', ['run', 'build'], { cwd: repo, stdio: ['ignore', log, log] });
    child = spawn(path.join(repo, 'node_modules/.bin/vite'), ['preview', '--port', String(port), '--strictPort'], { cwd: repo, detached: true, stdio: ['ignore', log, log] });
  } else {
    child = spawn(process.execPath, ['scripts/dev-server.ts', '--port', String(port), '--strictPort'], { cwd: repo, detached: true, stdio: ['ignore', log, log] });
  }
  child.unref();
  const base = `http://localhost:${port}`;
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const state = { id, dir, mode, port, pid: child.pid, base, head, lobbies: [], startedAt: new Date().toISOString() };
  saveState(dir, state);
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'current'), dir);
  const deadline = Date.now() + 90000;
  let last;
  while (Date.now() < deadline) {
    last = await probe(base);
    if (mode === 'prod' ? last.app === 200 : last.ready) break;
    await sleep(1000);
  }
  console.log(JSON.stringify({ run: dir, ...state, probe: last }, null, 2));
  if (!(mode === 'prod' ? last.app === 200 : last.ready)) process.exitCode = 1;
}

async function doctor() {
  const { dir, state } = currentRun();
  const owners = portOwner(state.port);
  const tree = [state.pid, ...descendants(state.pid)];
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim().length > 0;
  const p = await probe(state.base);
  const report = { run: dir, mode: state.mode, base: state.base, pidAlive: pidAlive(state.pid), portOwnedByRun: owners.some((x) => tree.includes(x)), headAtLaunch: state.head, headNow: head, dirty, ...p };
  report.ok = report.pidAlive && report.portOwnedByRun && report.app === 200 && (state.mode === 'prod' || report.api === 404) && head === state.head;
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

function deviceFor(name) {
  const { devices } = require('@playwright/test');
  return name === 'pixel' ? { ...devices['Pixel 7'], browserName: 'chromium' } : { ...devices['iPhone 14'], browserName: 'webkit' };
}

async function ui() {
  const pw = require('@playwright/test');
  const { dir, state } = currentRun();
  const device = deviceFor(o.device ?? 'iphone');
  const { browserName, ...ctxOpts } = device;
  const viewport = /^\d+x\d+$/.test(String(o.viewport ?? ''))
    ? { width: Number(String(o.viewport).split('x')[0]), height: Number(String(o.viewport).split('x')[1]) }
    : { width: 390, height: 844 };
  const browser = await pw[browserName].launch({ headless: true });
  const sessionFile = o.session ? path.join(dir, `session-${o.session}.json`) : null;
  const ctx = await browser.newContext({ ...ctxOpts, viewport, storageState: sessionFile && fs.existsSync(sessionFile) ? sessionFile : undefined });
  const page = await ctx.newPage();
  const log = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  const ev = evidenceDir(dir, o.feature ?? 'ui');
  const target = (spec) => {
    const [role, ...nameParts] = spec.split(':');
    const name = nameParts.join(':');
    if (role === 'text') return page.getByText(name).first();
    if (role === 'label') return page.getByLabel(name).first();
    if (role === 'css') return page.locator(name).first();
    return page.getByRole(role, name ? { name: name.startsWith('/') ? new RegExp(name.slice(1, -1), 'i') : name } : {}).first();
  };
  let failed = null;
  try {
    await page.goto(state.base + (o.path ?? '/'), { waitUntil: 'domcontentloaded' });
    for (const raw of o.step) {
      const step = raw.replace(/\{(\w+)\}/g, (_, k) => state.vars?.[k] ?? `{${k}}`);
      const t0 = Date.now();
      const [verb, ...argParts] = step.split(':');
      const arg = argParts.join(':');
      if (verb === 'click') await target(arg).click();
      else if (verb === 'fill') { const cut = arg.lastIndexOf('=>'); await target(arg.slice(0, cut)).fill(arg.slice(cut + 2)); }
      else if (verb === 'see') await target(arg).waitFor({ state: 'visible', timeout: Number(o.timeout ?? 20000) });
      else if (verb === 'gone') await target(arg).waitFor({ state: 'hidden', timeout: Number(o.timeout ?? 20000) });
      else if (verb === 'spinpick') {
        for (let n = 0; n < Number(arg || 10); n++) {
          const before = await page.locator('.slot.filled').count();
          if (before >= 10) break;
          for (let tries = 0; tries < 6; tries++) {
            await page.locator('.spin-big').click();
            const chip = page.locator('.chip:enabled').first();
            if (await chip.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) { await chip.click(); break; }
          }
          await page.waitForFunction((b) => document.querySelectorAll('.slot.filled').length > b, before, { timeout: 8000 });
        }
      }
      else if (verb === 'season') {
        let moments = 0;
        const deadline = Date.now() + Number(arg || 90000);
        while (Date.now() < deadline) {
          if (await page.locator('.award').first().isVisible().catch(() => false)) break;
          const card = page.locator('[data-testid="moment-card"]');
          if (await card.isVisible().catch(() => false)) { await card.locator('button').first().click(); moments++; await page.waitForTimeout(250); continue; }
          const skip = page.getByRole('button', { name: 'Skip to Result' });
          if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
          await page.waitForTimeout(250);
        }
        log.push({ step, moments, ms: Date.now() - t0 });
        continue;
      }
      else if (verb === 'read') { const [key, ...sel] = arg.split('='); const text = ((await page.locator(sel.join('=')).first().textContent({ timeout: 20000 })) ?? '').trim(); state.vars = { ...(state.vars ?? {}), [key]: text }; saveState(dir, state); if (/^[A-Z2-9]{6}$/.test(text) && !state.lobbies.includes(text)) { state.lobbies.push(text); saveState(dir, state); } log.push({ step, value: text }); continue; }
      else if (verb === 'until') {
        const [goal, ...rest] = arg.split('|');
        const buttons = rest.join('|').split(',');
        let clicks = 0;
        for (let i = 0; i < 150; i++) {
          if (await page.locator(goal).first().isVisible().catch(() => false)) break;
          let clicked = false;
          for (const sel of buttons) { const el = page.locator(sel).first(); if (await el.isVisible().catch(() => false)) { await el.click(); clicks++; clicked = true; break; } }
          if (!clicked) await page.waitForTimeout(200);
        }
        await page.locator(goal).first().waitFor({ state: 'visible', timeout: 5000 });
        log.push({ step, clicks, ms: Date.now() - t0 });
        continue;
      }
      else if (verb === 'reload') await page.reload({ waitUntil: 'domcontentloaded' });
      else if (verb === 'goto') await page.goto(state.base + arg, { waitUntil: 'domcontentloaded' });
      else if (verb === 'wait') await page.waitForTimeout(Number(arg));
      else if (verb === 'repeat') { const [n, ...inner] = arg.split('|'); for (let i = 0; i < Number(n); i++) { const [v2, ...a2] = inner.join('|').split(':'); if (v2 === 'click') { const el = target(a2.join(':')); if (await el.isVisible().catch(() => false)) await el.click(); } } }
      else if (verb === 'overflow') { const m = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })); log.push({ step, ...m }); if (m.scrollHeight > m.innerHeight + 1 || m.scrollWidth > m.innerWidth + 1) throw new Error(`overflow ${JSON.stringify(m)}`); continue; }
      else if (verb === 'shot') { await page.screenshot({ path: path.join(ev, `${arg}.png`) }); fs.writeFileSync(path.join(ev, `${arg}.aria.txt`), await page.locator('body').ariaSnapshot()); }
      else if (verb === 'storage') { const dump = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))); fs.writeFileSync(path.join(ev, `${arg || 'storage'}.json`), JSON.stringify(dump, null, 2)); }
      else throw new Error(`unknown step ${step}`);
      log.push({ step, ms: Date.now() - t0 });
    }
  } catch (e) {
    failed = String(e.message ?? e).split('\n')[0];
    await page.screenshot({ path: path.join(ev, 'failure.png') }).catch(() => {});
  }
  if (sessionFile) await ctx.storageState({ path: sessionFile });
  await browser.close();
  const result = { feature: o.feature ?? 'ui', device: o.device ?? 'iphone', viewport, base: state.base, ok: !failed, failed, steps: log, pageErrors: errors, evidence: ev };
  fs.appendFileSync(path.join(dir, 'evidence', 'journal.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...result }) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (failed) process.exitCode = 1;
}

async function api(base, method, route, secret, body) {
  const t0 = performance.now();
  const r = await fetch(base + route, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  return { ms: performance.now() - t0, status: r.status, bytes: Buffer.byteLength(text, 'utf8'), json: text ? JSON.parse(text) : null };
}

async function loadGuardPool() {
  const rules = fs.readFileSync(path.join(repo, 'src/shared/engine/rules.ts'), 'utf8');
  const sha = /DATA_SHA\s*=\s*'([0-9a-f]+)'/.exec(rules)?.[1];
  if (!sha) throw new Error('could not read DATA_SHA');
  const response = await fetch(`https://cdn.jsdelivr.net/gh/GrahamEves-1210/build-a-player@${sha}/src/data/nba-guards.js`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`guard data ${response.status}`);
  const text = await response.text();
  const marker = text.indexOf('export const NBA_GUARD_PLAYERS');
  if (marker < 0) throw new Error('NBA_GUARD_PLAYERS not found');
  const start = text.indexOf('[', marker);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return require('json5').parse(text.slice(start, i + 1));
    }
  }
  throw new Error('unterminated NBA_GUARD_PLAYERS');
}

async function lobbyLoad() {
  const base = baseUrl();
  const players = Number(o.players ?? 8);
  const seconds = Number(o.seconds ?? 20);
  const pollMs = Number(o.poll ?? 1000);
  const run = o.base ? null : currentRun();
  const samples = {};
  const add = (k, r) => { (samples[k] ??= { ms: [], bytes: [], status: {} }); samples[k].ms.push(r.ms); samples[k].bytes.push(r.bytes); samples[k].status[r.status] = (samples[k].status[r.status] ?? 0) + 1; };
  const seat = () => ({ secret: randomBytes(16).toString('hex'), version: 0, token: '', events: 0, away: new Map(), filled: new Map() });
  const GUARD_ATTRS = ['jumpShot', 'finishing', 'passing', 'handles', 'perimeterDefense', 'speed', 'bounce', 'size', 'basketballIQ', 'clutch'];
  const guardPool = await loadGuardPool();
  const pickFor = (attr) => {
    const player = guardPool.find((entry) => entry.attrs && entry.attrs[attr] !== undefined);
    if (!player) throw new Error(`no current guard has ${attr}`);
    return { attr, val: player.attrs[attr], playerName: player.name, playerShort: player.short ?? player.name, team: player.team };
  };
  const draftFor = (tick) => {
    const count = Math.min(1 + Math.floor(tick / 3), GUARD_ATTRS.length);
    const picks = {};
    for (let n = 0; n < count; n++) {
      const attr = GUARD_ATTRS[n];
      picks[attr] = pickFor(attr);
    }
    const last = picks[GUARD_ATTRS[count - 1]];
    return {
      position: 'guard',
      era: 'current',
      picks,
      spinIndex: tick,
      teamRespinUsed: false,
      playerRespinUsed: false,
      current: null,
      team: null,
      latest: { attr: last.attr, playerName: last.playerName },
    };
  };
  const absorb = (p, lobby, delta) => {
    if (lobby) {
      p.version = lobby.version;
      p.events = lobby.events[0]?.id ?? 0;
      for (const entry of lobby.participants) {
        p.away.set(entry.seat, Boolean(entry.away));
        p.filled.set(entry.seat, entry.summary?.filled ?? 0);
      }
    } else if (delta) {
      p.version = delta.version;
      for (const entry of delta.participants) {
        p.away.set(entry.seat, Boolean(entry.away));
        p.filled.set(entry.seat, entry.summary?.filled ?? 0);
      }
      p.events = Math.max(p.events, delta.events[0]?.id ?? 0);
    }
    p.token = `${p.events}:${[...p.away.values()].filter(Boolean).length}:${[...p.filled.values()].reduce((a, b) => a + b, 0)}`;
  };
  const host = seat();
  const created = await api(base, 'POST', '/api/lobby', host.secret, { name: 'Load0', actionId: randomUUID() });
  add('create', created);
  if (created.status >= 300) throw new Error(`create ${created.status} ${JSON.stringify(created.json)}`);
  const code = created.json.lobby.code;
  if (run) { run.state.lobbies.push(code); saveState(run.dir, run.state); }
  const guests = Array.from({ length: Math.max(0, players - 1) + Number(o.extra ?? 0) }, seat);
  const joins = await Promise.all(guests.map((g, i) => api(base, 'POST', `/api/lobby/${code}/join`, g.secret, { name: `Load${i + 1}`, actionId: randomUUID() }).then((r) => { add('join', r); return r; })));
  const seated = [host, ...guests.filter((_, i) => joins[i].status < 300)];
  const seatNumbers = [created.json.lobby.me.seat, ...joins.filter((j) => j.status < 300).map((j) => j.json.lobby.me.seat)];
  const joinStatuses = joins.reduce((acc, j) => ({ ...acc, [j.status]: (acc[j.status] ?? 0) + 1 }), {});
  const started = await api(base, 'POST', `/api/lobby/${code}/start`, host.secret, { actionId: randomUUID(), settings: { era: 'current', positions: ['guard', 'big'], revealSeconds: 4 } });
  add('start', started);
  const stopAt = Date.now() + seconds * 1000;
  await Promise.all(seated.map(async (p, idx) => {
    let draftTick = 0;
    while (Date.now() < stopAt) {
      const query = new URLSearchParams({ since: String(p.version), events: String(p.events) });
      if (p.token) query.set('token', p.token);
      const r = await api(base, 'GET', `/api/lobby/${code}?${query.toString()}`, p.secret);
      add(r.status === 204 ? 'poll-204' : r.json?.delta ? 'poll-200-delta' : 'poll-200', r);
      absorb(p, r.json?.lobby, r.json?.delta);
      if (o.drafts !== 'off' && ++draftTick % 3 === idx % 3) {
        const d = await api(base, 'POST', `/api/lobby/${code}/build`, p.secret, { actionId: randomUUID(), draft: draftFor(draftTick) });
        add('build-sync', d);
        absorb(p, d.json?.lobby);
      }
      await sleep(pollMs);
    }
  }));
  for (const p of seated) add('leave', await api(base, 'POST', `/api/lobby/${code}/leave`, p.secret, { actionId: randomUUID() }));
  const summary = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, { n: v.ms.length, p50: median(v.ms), p95: pct(v.ms, 95), max: Math.round(Math.max(...v.ms)), bytesTotal: v.bytes.reduce((a, b) => a + b, 0), bytesP50: median(v.bytes), status: v.status }]));
  const poll = (() => {
    const full = samples['poll-200'] ?? { ms: [], bytes: [] };
    const delta = samples['poll-200-delta'] ?? { ms: [], bytes: [] };
    const empty = samples['poll-204'] ?? { ms: [], bytes: [] };
    const ms = [...full.ms, ...delta.ms, ...empty.ms];
    const bytes = [...full.bytes, ...delta.bytes, ...empty.bytes];
    const n200 = full.ms.length + delta.ms.length;
    const bytesTotal = bytes.reduce((a, b) => a + b, 0);
    const n = ms.length;
    return {
      n,
      p50: median(ms),
      p95: pct(ms, 95),
      n200,
      nFull: full.ms.length,
      nDelta: delta.ms.length,
      n204: empty.ms.length,
      share204: n ? Math.round((empty.ms.length / n) * 100) : null,
      bytesTotal,
      bytesPerPoll: n ? Math.round(bytesTotal / n) : null,
      bytesPerFull: full.ms.length ? Math.round(full.bytes.reduce((a, b) => a + b, 0) / full.ms.length) : null,
      bytesPerDelta: delta.ms.length ? Math.round(delta.bytes.reduce((a, b) => a + b, 0) / delta.ms.length) : null,
    };
  })();
  const buildSyncStatus = samples['build-sync']?.status ?? {};
  const rejectedSyncs = Object.entries(buildSyncStatus).filter(([status]) => Number(status) >= 300);
  if (rejectedSyncs.length) console.error(`lobby-load: build syncs rejected: ${rejectedSyncs.map(([status, count]) => `${status} x${count}`).join(', ')}`);
  const result = { base, code, players, attemptedJoins: guests.length, seated: seated.length, seconds, pollMs, startStatus: started.status, summary, poll, joinStatuses, seatNumbers, distinctSeats: new Set(seatNumbers).size, buildSyncStatus };
  if (run) fs.writeFileSync(path.join(evidenceDir(run.dir, 'perf'), `lobby-load-${Date.now()}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (rejectedSyncs.length) process.exitCode = 1;
}

const PERF_INIT = (re) => {
  window.__perf = { lcp: 0, longTasks: 0, tti: null };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longTasks += e.duration; }).observe({ type: 'longtask', buffered: true }); } catch {}
  const rx = new RegExp(re, 'i');
  const poll = () => { if (window.__perf.tti != null) return; for (const b of document.querySelectorAll('button')) { const r = b.getBoundingClientRect(); if (!b.disabled && r.width > 0 && r.height > 0 && rx.test((b.innerText || '').trim())) { window.__perf.tti = performance.now(); return; } } requestAnimationFrame(poll); };
  requestAnimationFrame(poll);
};

async function coldLoad() {
  const pw = require('@playwright/test');
  const url = o.url ?? baseUrl() + '/';
  const runs = Number(o.runs ?? 5);
  const visits = Math.max(1, Number(o.visits ?? 1));
  const settle = Number(o.settle ?? 5000);
  const browser = await pw.chromium.launch({ headless: true });
  const out = [];
  const tracked = new Set(['Document', 'Script', 'Fetch', 'XHR']);
  try {
    for (let i = 0; i < runs; i++) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: pw.devices['iPhone 14'].userAgent });
      await ctx.addInitScript(PERF_INIT, o['tti-re'] ?? '^PLAY\\b');
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable'); await cdp.send('Performance.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      let bucket = null;
      cdp.on('Network.requestWillBeSent', (e) => {
        if (!bucket) return;
        bucket.requestCount++;
        if (bucket.navAt === null) bucket.navAt = e.timestamp;
        if (tracked.has(e.type) && bucket.network.length < 80) bucket.network.push({ id: e.requestId, url: e.request.url, type: e.type, start: e.timestamp });
      });
      cdp.on('Network.responseReceived', (e) => {
        const hit = bucket?.network.find((r) => r.id === e.requestId);
        if (!hit) return;
        hit.status = e.response.status;
        const t = e.response.timing;
        if (t) hit.timing = { dns: t.dnsEnd - t.dnsStart, connect: t.connectEnd - t.connectStart, ssl: t.sslEnd - t.sslStart, ttfb: t.receiveHeadersEnd };
      });
      cdp.on('Network.loadingFinished', (e) => {
        if (!bucket) return;
        bucket.transferredBytes += e.encodedDataLength || 0;
        const hit = bucket.network.find((r) => r.id === e.requestId);
        if (hit) { hit.end = e.timestamp; hit.bytes = e.encodedDataLength; }
      });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
      const samples = [];
      for (let v = 0; v < visits; v++) {
        if (v > 0) await page.evaluate(() => localStorage.clear());
        bucket = { navAt: null, transferredBytes: 0, requestCount: 0, network: [] };
        const t0 = Date.now();
        await page.goto(url, { waitUntil: 'load', timeout: 120000 });
        const loadMs = Date.now() - t0;
        let firstSpinMs = null;
        let spinError = null;
        try {
          await page.waitForFunction(
            (re) => [...document.querySelectorAll('button')].some((b) => !b.disabled && b.getBoundingClientRect().width > 0 && new RegExp(re, 'i').test((b.innerText || '').trim())),
            o['tti-re'] ?? '^PLAY\\b',
            { timeout: 90000 },
          );
          await page.getByRole('button', { name: /^play ·/i }).first().click();
          await page.locator('.spin-big').first().click();
          await page.locator('.chip:enabled').first().waitFor({ state: 'visible', timeout: 60000 });
          firstSpinMs = Date.now() - t0;
        } catch (error) {
          spinError = String(error.message ?? error).split('\n')[0].slice(0, 200);
        }
        await page.waitForTimeout(settle);
        const p = await page.evaluate(() => ({ ...window.__perf, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null }));
        const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
        samples.push({
          visit: v + 1,
          fcpMs: p.fcp,
          lcpMs: p.lcp || null,
          ttiIshMs: p.tti,
          firstSpinMs,
          spinError,
          loadMs,
          transferredBytes: bucket.transferredBytes,
          requestCount: bucket.requestCount,
          jsHeapUsedBytes: m.JSHeapUsedSize,
          longTasksMs: Math.round(p.longTasks),
          network: bucket.network.map((r) => ({
            url: r.url,
            status: r.status ?? null,
            startMs: bucket.navAt === null ? null : Math.round((r.start - bucket.navAt) * 1000),
            ms: r.end === undefined ? null : Math.round((r.end - r.start) * 1000),
            bytes: r.bytes ?? null,
            timing: r.timing ?? null,
          })),
        });
      }
      out.push({ run: i + 1, visits: samples, pageErrors: errors });
      await ctx.close();
    }
  } finally { await browser.close(); }
  const keys = ['fcpMs', 'lcpMs', 'ttiIshMs', 'firstSpinMs', 'loadMs', 'transferredBytes', 'requestCount', 'jsHeapUsedBytes', 'longTasksMs'];
  const summarize = (rows) => Object.fromEntries(keys.map((k) => { const v = rows.map((r) => r[k]).filter((x) => x != null); return [k, { median: median(v), min: v.length ? Math.round(Math.min(...v)) : null, max: v.length ? Math.round(Math.max(...v)) : null, n: v.length }]; }));
  const summary = summarize(out.map((r) => r.visits[0]));
  const result = { url, runs, visits, conditions: 'iPhone 14 390x844 DPR3, 9/1.5 Mbps 60 ms RTT, CPU 4x, cache off, fresh context (same as perf/baseline-original.json)', summary, detail: out };
  if (visits > 1) result.repeatSummary = summarize(out.map((r) => r.visits[1]).filter(Boolean));
  let file = null;
  try { const run = currentRun(); file = path.join(evidenceDir(run.dir, 'perf'), `cold-load-${Date.now()}.json`); fs.writeFileSync(file, JSON.stringify(result, null, 2)); } catch {}
  console.log(JSON.stringify({ ...result, detail: undefined, file }, null, 2));
}

async function cleanup() {
  const { dir, state } = currentRun();
  const killed = [];
  for (const pid of [...descendants(state.pid).reverse(), state.pid]) { if (pidAlive(pid)) { try { process.kill(pid, 'SIGTERM'); killed.push(pid); } catch {} } }
  await sleep(1500);
  for (const pid of killed) if (pidAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  let removed = [];
  if (state.lobbies.length && state.mode === 'dev') {
    const outText = execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'drop-lobbies.ts'), ...state.lobbies], { cwd: repo, encoding: 'utf8' });
    removed = JSON.parse(outText);
  }
  fs.rmSync(path.join(home, 'current'), { force: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith('session-')) fs.rmSync(path.join(dir, f));
  const evidence = path.join(dir, 'evidence');
  console.log(JSON.stringify({ stopped: killed, portFree: portOwner(state.port).length === 0, lobbiesRemoved: removed, evidence, evidenceFiles: fs.readdirSync(evidence, { recursive: true }).length }, null, 2));
}

const table = { launch, doctor, ui, 'lobby-load': lobbyLoad, 'cold-load': coldLoad, cleanup };
if (!table[cmd]) { console.error('usage: control.mjs launch [--port N] [--prod] | doctor | ui --feature F [--device iphone|pixel] [--viewport 390x844] [--session S] [--path /] --step ... | lobby-load [--players 8] [--extra 4] [--seconds 20] [--poll 1000] [--base URL] [--drafts off] | cold-load [--url URL] [--runs 5] [--visits 2] | cleanup'); process.exit(2); }
await table[cmd]();
