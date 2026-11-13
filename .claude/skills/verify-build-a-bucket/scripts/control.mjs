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
  const browser = await pw[browserName].launch({ headless: true });
  const sessionFile = o.session ? path.join(dir, `session-${o.session}.json`) : null;
  const ctx = await browser.newContext({ ...ctxOpts, viewport: { width: 390, height: 844 }, storageState: sessionFile && fs.existsSync(sessionFile) ? sessionFile : undefined });
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
  const result = { feature: o.feature ?? 'ui', device: o.device ?? 'iphone', base: state.base, ok: !failed, failed, steps: log, pageErrors: errors, evidence: ev };
  fs.appendFileSync(path.join(dir, 'evidence', 'journal.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...result }) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (failed) process.exitCode = 1;
}

async function api(base, method, route, secret, body) {
  const t0 = performance.now();
  const r = await fetch(base + route, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  return { ms: performance.now() - t0, status: r.status, json: text ? JSON.parse(text) : null };
}

async function lobbyLoad() {
  const base = baseUrl();
  const players = Number(o.players ?? 8);
  const seconds = Number(o.seconds ?? 20);
  const pollMs = Number(o.poll ?? 1000);
  const run = o.base ? null : currentRun();
  const samples = {};
  const add = (k, r) => { (samples[k] ??= { ms: [], status: {} }); samples[k].ms.push(r.ms); samples[k].status[r.status] = (samples[k].status[r.status] ?? 0) + 1; };
  const seat = () => ({ secret: randomBytes(16).toString('hex'), version: 0 });
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
      const r = await api(base, 'GET', `/api/lobby/${code}?since=${p.version}`, p.secret);
      add(r.status === 204 ? 'poll-204' : 'poll-200', r);
      if (r.status === 200) p.version = r.json.lobby.version ?? p.version;
      if (o.drafts !== 'off' && ++draftTick % 3 === idx % 3) {
        const d = await api(base, 'POST', `/api/lobby/${code}/build`, p.secret, { actionId: randomUUID(), draft: { position: 'guard', era: 'current', picks: {}, spinIndex: 0, teamRespinUsed: false, playerRespinUsed: false, current: null, team: null, latest: null } });
        add('build-sync', d);
      }
      await sleep(pollMs);
    }
  }));
  for (const p of seated) add('leave', await api(base, 'POST', `/api/lobby/${code}/leave`, p.secret, { actionId: randomUUID() }));
  const summary = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, { n: v.ms.length, p50: median(v.ms), p95: pct(v.ms, 95), max: Math.round(Math.max(...v.ms)), status: v.status }]));
  const result = { base, code, players, attemptedJoins: guests.length, seated: seated.length, seconds, pollMs, startStatus: started.status, summary, joinStatuses, seatNumbers, distinctSeats: new Set(seatNumbers).size };
  if (run) fs.writeFileSync(path.join(evidenceDir(run.dir, 'perf'), `lobby-load-${Date.now()}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
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
  const settle = Number(o.settle ?? 5000);
  const browser = await pw.chromium.launch({ headless: true });
  const out = [];
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
      let bytes = 0, reqs = 0;
      cdp.on('Network.requestWillBeSent', () => reqs++);
      cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
      const t0 = Date.now();
      await page.goto(url, { waitUntil: 'load', timeout: 120000 });
      const loadMs = Date.now() - t0;
      await page.waitForTimeout(settle);
      const p = await page.evaluate(() => ({ ...window.__perf, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null }));
      const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
      out.push({ fcpMs: p.fcp, lcpMs: p.lcp || null, ttiIshMs: p.tti, loadMs, transferredBytes: bytes, requestCount: reqs, jsHeapUsedBytes: m.JSHeapUsedSize, longTasksMs: Math.round(p.longTasks), pageErrors: errors });
      await ctx.close();
    }
  } finally { await browser.close(); }
  const keys = ['fcpMs', 'lcpMs', 'ttiIshMs', 'loadMs', 'transferredBytes', 'requestCount', 'jsHeapUsedBytes', 'longTasksMs'];
  const summary = Object.fromEntries(keys.map((k) => { const v = out.map((r) => r[k]).filter((x) => x != null); return [k, { median: median(v), min: v.length ? Math.round(Math.min(...v)) : null, max: v.length ? Math.round(Math.max(...v)) : null, n: v.length }]; }));
  const result = { url, runs, conditions: 'iPhone 14 390x844 DPR3, 9/1.5 Mbps 60 ms RTT, CPU 4x, cache off, fresh context (same as perf/baseline-original.json)', summary, detail: out };
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
if (!table[cmd]) { console.error('usage: control.mjs launch [--port N] [--prod] | doctor | ui --feature F [--device iphone|pixel] [--session S] [--path /] --step ... | lobby-load [--players 8] [--extra 4] [--seconds 20] [--poll 1000] [--base URL] | cold-load [--url URL] [--runs 5] | cleanup'); process.exit(2); }
await table[cmd]();
