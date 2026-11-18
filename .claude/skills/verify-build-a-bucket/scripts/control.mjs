#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareStandings, createLeagueEvidenceDir, isValidRevision, leagueFailureSummary, readLeagueStandings, reloadRecord } from './standings-check.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(path.join(repo, 'package.json'));
const localDb = await import(path.join(repo, 'scripts/local-db.mjs'));
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
  const local = mode === 'dev' && !o.neon;
  const localHandle = local
    ? await localDb.startLocalDb({
        root: repo,
        dataDir: path.join(dir, 'pgdata'),
        pgPort: Number(o['pg-port'] ?? 55500 + Math.floor(Math.random() * 400)),
      })
    : null;
  const env = localHandle ? { ...process.env, ...localDb.localDbEnv(localHandle) } : process.env;
  let child;
  const log = fs.openSync(path.join(dir, 'server.log'), 'a');
  if (mode === 'prod') {
    execFileSync('npm', ['run', 'build'], { cwd: repo, stdio: ['ignore', log, log] });
    child = spawn(path.join(repo, 'node_modules/.bin/vite'), ['preview', '--port', String(port), '--strictPort'], { cwd: repo, detached: true, stdio: ['ignore', log, log] });
  } else {
    child = spawn(process.execPath, ['scripts/dev-server.ts', '--port', String(port), '--strictPort'], { cwd: repo, detached: true, stdio: ['ignore', log, log], env });
  }
  child.unref();
  const base = `http://localhost:${port}`;
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const state = {
    id,
    dir,
    mode,
    port,
    pid: child.pid,
    base,
    head,
    lobbies: [],
    localDb: localHandle
      ? {
          dataDir: localHandle.dataDir,
          pgPort: localHandle.pgPort,
          database: localHandle.database,
          url: localHandle.url,
          runnerPath: localHandle.runnerPath,
        }
      : null,
    startedAt: new Date().toISOString(),
  };
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
  if (!(mode === 'prod' ? last.app === 200 : last.ready)) {
    if (localHandle) await localDb.stopLocalDb(localHandle);
    process.exitCode = 1;
  }
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
      else if (verb === 'scroll') { await target(arg).evaluate((element) => element.scrollIntoView({ block: 'start' })); await page.waitForTimeout(300); }
      else if (verb === 'cover') {
        const m = await target(arg).evaluate((element) => {
          const rows = [...element.querySelectorAll('.table-row:not(.head)')];
          const visible = rows.filter((row) => {
            const rect = row.getBoundingClientRect();
            const box = row.closest('.table')?.getBoundingClientRect();
            const top = Math.max(0, box ? box.top : 0);
            const bottom = Math.min(window.innerHeight, box ? box.bottom : window.innerHeight);
            return rect.top >= top && rect.bottom <= bottom;
          });
          const hits = visible.map((row) => {
            const rect = row.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + Math.min(20, rect.width / 2), rect.top + rect.height / 2);
            return hit !== null && !row.contains(hit) ? { hit, row } : null;
          });
          const covered = hits.filter((hit) => hit !== null);
          const byHeader = covered.filter((entry) => entry.hit.closest('.table-row.head') !== null).length;
          const others = covered
            .filter((entry) => entry.hit.closest('.table-row.head') === null)
            .map((entry) => `${entry.row.innerText.replace(/\s+/g, ' ').slice(0, 18)} <- ${entry.hit.tagName.toLowerCase()}.${String(entry.hit.className)}`);
          return { rows: rows.length, visible: visible.length, coveredByHeader: byHeader, coveredByOther: covered.length - byHeader, covers: others };
        });
        log.push({ step, ...m });
        if (m.coveredByOther > 0) throw new Error(`covered rows ${JSON.stringify(m)}`);
        continue;
      }
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

async function leagueRun() {
  const pw = require('@playwright/test');
  const { dir, state } = currentRun();
  const players = Math.max(2, Math.min(8, Number(o.players ?? 2)));
  const mode = String(o.mode ?? 'normal');
  if (!['normal', 'salary', 'squad'].includes(mode)) throw new Error(`unknown mode ${mode}`);
  const era = String(o.era ?? 'current');
  if (!['current', 'alltime'].includes(era)) throw new Error(`unknown era ${era}`);
  const device = deviceFor(o.device ?? 'iphone');
  const { browserName, ...ctxOpts } = device;
  const viewport = /^\d+x\d+$/.test(String(o.viewport ?? ''))
    ? { width: Number(String(o.viewport).split('x')[0]), height: Number(String(o.viewport).split('x')[1]) }
    : { width: 390, height: 844 };
  const reloadSeat = o.reload === undefined ? null : Number(o.reload);
  const reload = { ran: false, revision: null, seats: [], rowsCompared: 0, refreshedSeat: null };
  const awaySeat = o.away === undefined ? null : Number(o.away);
  const hostLeave = Boolean(o['host-leave']);
  for (const [flag, value] of [['--reload', reloadSeat], ['--away', awaySeat]]) {
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > players)) throw new Error(`${flag} must be a seat 1..${players}`);
  }
  if (awaySeat !== null && hostLeave) throw new Error('--away and --host-leave are separate scenarios');
  const base = o.base ?? state.base;
  const browser = await pw[browserName].launch({ headless: true });
  const ev = createLeagueEvidenceDir(path.join(dir, 'evidence'));
  const names = ['Ava', 'Ben', 'Cara', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana'];
  const seats = [];
  const apiSamples = new Map();
  const requestStarts = new WeakMap();
  const apiKey = (method, url) => {
    const pathname = new URL(url).pathname.replace(/\/api\/lobby\/[A-Za-z0-9]{6}(?=\/|$)/, '/api/lobby/:code');
    return `${method} ${pathname}`;
  };
  for (let index = 0; index < players; index++) {
    const context = await browser.newContext({ ...ctxOpts, viewport });
    const page = await context.newPage();
    const errors = [];
    const http = [];
    page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text().slice(0, 200)); });
    page.on('response', (response) => {
      if (response.status() < 400) return;
      const entry = { status: response.status(), method: response.request().method(), url: response.url(), body: '' };
      http.push(entry);
      response.text().then((text) => { entry.body = text.slice(0, 300); }).catch(() => {});
    });
    page.on('request', (request) => {
      if (request.url().includes('/api/')) requestStarts.set(request, Date.now());
    });
    page.on('response', (response) => {
      const request = response.request();
      if (!request.url().includes('/api/')) return;
      const started = requestStarts.get(request);
      if (started === undefined) return;
      const key = apiKey(request.method(), request.url());
      const sample = apiSamples.get(key) ?? { ms: [], status: {} };
      sample.ms.push(Date.now() - started);
      sample.status[response.status()] = (sample.status[response.status()] ?? 0) + 1;
      apiSamples.set(key, sample);
    });
    seats.push({ index, seat: index + 1, name: names[index], context, page, errors, http, closed: false, actions: {} });
  }
  const tap = (seat, name) => { seat.actions[name] = (seat.actions[name] ?? 0) + 1; };
  const active = () => seats.filter((seat) => !seat.closed);
  const clean = (text) => text.replace(/YOU/g, '').replace(/\s+/g, ' ').trim();
  const snap = async (seat, label) => {
    await seat.page.screenshot({ path: path.join(ev, `${seat.seat}-${seat.name}-${label}.png`) });
    fs.writeFileSync(path.join(ev, `${seat.seat}-${seat.name}-${label}.aria.txt`), await seat.page.locator('body').ariaSnapshot());
  };
  const visible = async (seat, testId) => seat.page.getByTestId(testId).isVisible().catch(() => false);
  const anyVisible = async (testId) => {
    for (const seat of active()) if (await visible(seat, testId)) return true;
    return false;
  };
  const phaseOf = async (seat) => clean(await seat.page.getByTestId('lobby-status').innerText());
  const spinPick = async (page) => {
    for (let index = 0; index < 10; index++) {
      await page.locator('.spin-big').click();
      const chip = page.locator('.chip:enabled').first();
      await chip.waitFor({ state: 'visible', timeout: 20000 });
      await chip.click();
      await page.waitForTimeout(650);
    }
  };
  const readTables = async (seat) =>
    seat.page.getByTestId('standings').locator('.table').evaluateAll((tables) =>
      tables.map((table) =>
        [...table.querySelectorAll('.table-row:not(.head)')].map((row) => (row.innerText || '').replace(/YOU/g, '').replace(/\s+/g, ' ').trim()),
      ),
    );
  const parseRow = (text) => {
    const head = /^(\d+|—)\s+([A-Z]{2,3})\b/.exec(text);
    if (!head) return null;
    const record = /(\d+)-(\d+)/.exec(text);
    return { seed: head[1] === '—' ? null : Number(head[1]), team: head[2], wins: record ? Number(record[1]) : null, losses: record ? Number(record[2]) : null };
  };
  const parseMine = (text) => {
    const match = /([A-Z]{2,3})\s+(\d+)-(\d+)(?:\s+·\s+#(\d+))?/.exec(text);
    return match ? { team: match[1], wins: Number(match[2]), losses: Number(match[3]), seed: match[4] ? Number(match[4]) : null } : null;
  };
  const waitStage = async (seat, timeout = 150000) =>
    seat.page.waitForFunction(
      () => document.querySelector('[data-testid="league-stage"]') || document.querySelector('[data-testid="recap"]'),
      null,
      { timeout },
    );
  const stageName = async (seat) => {
    const card = seat.page.getByTestId('league-stage');
    if (!(await card.isVisible().catch(() => false))) return null;
    return card
      .locator('.tiny.muted')
      .first()
      .innerText({ timeout: 2000 })
      .then(clean)
      .catch(() => null);
  };
  const roundName = async (seat) => {
    const playoffs = seat.page.getByTestId('playoffs');
    if (!(await playoffs.isVisible().catch(() => false))) return null;
    const names = await playoffs.locator('.round-name').allInnerTexts().catch(() => []);
    return names.length ? clean(names[names.length - 1]) : null;
  };
  const clickReady = async (seat) => {
    const button = seat.page.getByTestId('playoff-gate').getByRole('button', { name: 'Ready', exact: true });
    if ((await button.isVisible().catch(() => false)) && (await button.isEnabled().catch(() => false))) {
      tap(seat, 'Ready');
      await button.click().catch(() => {});
      return true;
    }
    return false;
  };
  const startPlayoffs = async () => {
    for (const seat of active()) {
      const button = seat.page.getByTestId('playoff-gate').getByRole('button', { name: 'Start playoffs', exact: true });
      if (await button.isVisible().catch(() => false)) {
        tap(seat, 'Start playoffs');
        await button.click().catch(() => {});
        return seat;
      }
    }
    return null;
  };
  const findHost = async (testId) => {
    for (const seat of active()) if (await visible(seat, testId)) return seat;
    return null;
  };
  const verifyStageInner = async (label, previous) => {
    for (const seat of active()) await waitStage(seat);
    if (previous) {
      const deadline = Date.now() + 20000;
      for (;;) {
        if (await visible(active()[0], 'recap')) break;
        const name = (await roundName(active()[0])) ?? (await stageName(active()[0]));
        if (name !== previous) break;
        if (Date.now() > deadline) throw new Error(`stage did not change from ${previous} at ${label}`);
        await sleep(300);
      }
      for (const seat of active()) await waitStage(seat);
    }
    let phases = [];
    let phase = '';
    const phaseDeadline = Date.now() + 30000;
    for (;;) {
      phases = [];
      for (const seat of active()) phases.push(await phaseOf(seat));
      phase = phases[0];
      if (phases.every((value) => value === phase)) break;
      if (Date.now() > phaseDeadline) throw new Error(`phase differs at ${label}: ${phases.join(' | ')}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    let tables = [];
    let top = [];
    const standingsDeadline = Date.now() + 8000;
    for (;;) {
      tables = [];
      for (const seat of active()) tables.push(await readTables(seat));
      top = tables.map((conference) => conference.map((rows) => rows.slice(0, 10)));
      const first = JSON.stringify(top[0]);
      const mismatch = top.findIndex((entry) => JSON.stringify(entry) !== first);
      if (mismatch < 0) break;
      if (Date.now() > standingsDeadline) throw new Error(`standings differ at ${label} for seat ${active()[mismatch].seat}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const mine = [];
    for (let index = 0; index < active().length; index++) {
      const seat = active()[index];
      const text = clean(await seat.page.getByTestId('my-team').innerText());
      const parsed = parseMine(text);
      if (!parsed) throw new Error(`cannot read my-team at ${label} for seat ${seat.seat}: ${text}`);
      const row = tables[index].flat().map(parseRow).find((entry) => entry && entry.team === parsed.team);
      if (!row) throw new Error(`my team ${parsed.team} missing from standings at ${label}`);
      if (row.wins !== parsed.wins || row.losses !== parsed.losses) throw new Error(`record disagrees with standings at ${label} for seat ${seat.seat}`);
      if (row.seed !== parsed.seed) throw new Error(`seed disagrees with standings at ${label} for seat ${seat.seat}`);
      mine.push({ seat: seat.seat, name: seat.name, ...parsed });
    }
    let states = [];
    for (const seat of active()) states.push({ seat, phase: await phaseOf(seat), banner: await visible(seat, 'champion-banner') });
    const livePhase = await phaseOf(active()[0]);
    if (livePhase !== phase) {
      phase = livePhase;
      states = [];
      for (const seat of active()) states.push({ seat, phase: await phaseOf(seat), banner: await visible(seat, 'champion-banner') });
    }
    if (phase === 'Season running') {
      for (const state of states) {
        if (state.phase !== phase) continue;
        for (const testId of ['awards', 'playin', 'playoffs', 'champion-banner']) {
          if (await visible(state.seat, testId)) throw new Error(`${testId} revealed during the season at ${label} for seat ${state.seat.seat}`);
        }
      }
      if (mine.some((entry) => entry.seed !== null)) throw new Error(`seed revealed during the season at ${label}`);
    } else if (phase === 'Awards') {
      if (!(await anyVisible('awards'))) throw new Error(`awards missing at ${label}`);
      for (const state of states) {
        if (state.phase !== phase) continue;
        for (const testId of ['playin', 'playoffs', 'champion-banner']) {
          if (await visible(state.seat, testId)) throw new Error(`${testId} revealed at awards ${label} for seat ${state.seat.seat}`);
        }
      }
      if (mine.some((entry) => entry.seed === null)) throw new Error(`seed missing at awards ${label}`);
    } else if (phase === 'Play-In') {
      if (!(await anyVisible('playin'))) throw new Error(`play-in missing at ${label}`);
      for (const state of states) {
        if (state.phase !== phase) continue;
        for (const testId of ['playoffs', 'champion-banner']) {
          if (await visible(state.seat, testId)) throw new Error(`${testId} revealed at play-in ${label} for seat ${state.seat.seat}`);
        }
      }
    } else if (phase === 'Playoffs') {
      if (!(await anyVisible('playoffs'))) throw new Error(`playoffs missing at ${label}`);
      for (const state of states) {
        if (state.phase === phase && state.banner) throw new Error(`champion revealed before the recap at ${label} for seat ${state.seat.seat}`);
      }
    } else if (phase === 'Recap') {
      const recapDeadline = Date.now() + 20000;
      for (;;) {
        const pending = [];
        for (const seat of active()) if ((await phaseOf(seat)) !== 'Recap') pending.push(seat.seat);
        if (!pending.length) break;
        if (Date.now() > recapDeadline) throw new Error(`seats not at recap ${label}: ${pending.join(', ')}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      for (const seat of active()) if (!(await visible(seat, 'champion-banner'))) throw new Error(`champion missing at recap ${label} for seat ${seat.seat}`);
    } else {
      throw new Error(`unexpected phase ${phase} at ${label}`);
    }
    let champion = null;
    if (phase === 'Recap') {
      const banners = [];
      for (const seat of active()) banners.push(clean(await seat.page.getByTestId('champion-banner').innerText()));
      if (!banners.every((value) => value === banners[0])) throw new Error(`champion text differs at ${label}`);
      champion = banners[0];
    }
    const cardName = await stageName(active()[0]);
    const lastRound = await roundName(active()[0]);
    return {
      label,
      phase,
      stageName: cardName,
      roundName: lastRound,
      stageNameMismatch: phase === 'Playoffs' && cardName !== null && lastRound !== null && cardName !== lastRound,
      standings: top[0],
      mine,
      champion,
      at: Date.now(),
    };
  };
  const verifyStage = async (label, previous) => {
    try {
      return await verifyStageInner(label, previous);
    } catch (error) {
      const states = [];
      for (const seat of active()) {
        const phase = await phaseOf(seat).catch(() => 'unknown');
        const banner = await visible(seat, 'champion-banner').catch(() => false);
        states.push({ seat: seat.seat, name: seat.name, phase, banner });
        await snap(seat, `failure-${label}`).catch(() => {});
      }
      fs.writeFileSync(path.join(ev, `failure-${label}.json`), JSON.stringify({ label, error: String(error), states }, null, 2));
      throw error;
    }
  };
  const stages = [];
  const marks = [];
  const gateWaits = [];
  const mark = (label) => {
    if (!marks.some((entry) => entry.label === label)) marks.push({ label, at: Date.now() });
  };
  const markRounds = async (seat, current) => {
    const names = await seat.page.getByTestId('playoffs').locator('.round-name').allInnerTexts().catch(() => []);
    const wanted = clean(current ?? '').toUpperCase();
    const index = names.findIndex((name) => clean(name).toUpperCase() === wanted);
    for (const name of names.slice(0, index + 1)) {
      const label = `round:${clean(name).toUpperCase()}`;
      if (!marks.some((entry) => entry.label === label)) mark(label);
    }
  };
  const seriesScores = new Map();
  const seriesKeys = new Map();
  const recordSeries = async (seat) => {
    const card = seat.page.getByTestId('my-matchup');
    if (!(await card.isVisible().catch(() => false))) return;
    const text = await card.innerText().catch(() => '');
    const match = /(\d+)[–-](\d+)/.exec(text);
    if (!match) return;
    const key = `${seat.seat}:${seat.name}`;
    const seriesKey = text.split('\n')[0];
    if (seriesKeys.get(key) !== seriesKey) {
      seriesKeys.set(key, seriesKey);
      seriesScores.set(key, new Set());
    }
    if (!seriesScores.has(key)) seriesScores.set(key, new Set());
    seriesScores.get(key).add(`${match[1]}-${match[2]}`);
  };
  const logText = async (seat) => seat.page.getByTestId('activity-log').innerText().catch(() => '');
  const installSeriesObserver = async (seat) =>
    seat.page.evaluate(() => {
      const target = window;
      performance.setResourceTimingBufferSize(10000);
      target.__seriesScores = [];
      target.__nextActions = [];
      target.__logs = [];
      const read = () => {
        const card = document.querySelector('[data-testid="my-matchup"]');
        if (card) {
          const text = card.textContent ?? '';
          const match = /(\d+)[–-](\d+)/.exec(text);
          if (match) {
            const teams = /([A-Z]{2,3})\s+\d+[–-]\d+\s+([A-Z]{2,3})/.exec(text)?.slice(1) ?? [];
            const row = Array.from(document.querySelectorAll('.series')).find((entry) => teams.every((team) => (entry.textContent ?? '').includes(team)));
            const bracketScore = row?.querySelector('.series-score')?.textContent?.replace('–', '-').trim() ?? null;
            target.__seriesScores.push({ key: card.querySelector('.tiny.muted')?.textContent ?? '', score: `${match[1]}-${match[2]}`, teams, bracketScore, at: Date.now() });
          }
        }
        const next = document.querySelector('[data-testid="next-action"]');
        if (next) target.__nextActions.push({ text: next.textContent ?? '', at: Date.now() });
        const log = document.querySelector('[data-testid="activity-log"]');
        if (log) target.__logs.push({ text: log.textContent ?? '', at: Date.now() });
      };
      new window.MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
      read();
    });
  const buildAndStart = async (hostSeat, activeSeats, recordMarks, chooseSettings) => {
    if (chooseSettings) {
      if (mode !== 'normal') await hostSeat.page.getByRole('button', { name: mode === 'salary' ? 'Salary' : 'Squad', exact: true }).click();
      if (era !== 'current') await hostSeat.page.getByRole('button', { name: 'All-Time', exact: true }).click();
      await hostSeat.page.getByTestId('start-season').click();
    }
    await hostSeat.page.getByTestId('open-builder').waitFor();
    await hostSeat.page.waitForTimeout(800);
    for (const seat of activeSeats) {
      await seat.page.getByTestId('open-builder').click();
      if (mode === 'salary') {
        await seat.page.getByTestId('lobby-salary-scout').click();
        await seat.page.getByTestId('lobby-salary-card-0-0').click();
        await seat.page.waitForTimeout(800);
        for (let column = 0; column < 5; column++) {
          const cards = seat.page.getByTestId(new RegExp(`^lobby-salary-card-${column}-\\d+$`));
          const count = await cards.count();
          let cheapest = 0;
          let price = Infinity;
          for (let index = 0; index < count; index++) {
            const text = await cards.nth(index).innerText();
            const match = /(\d+)M/.exec(text);
            const value = match ? Number(match[1]) : Infinity;
            if (value < price) { price = value; cheapest = index; }
          }
          await seat.page.getByTestId(`lobby-salary-card-${column}-${cheapest}`).click();
        }
        await seat.page.getByTestId('lobby-salary-submit').click();
      } else if (mode === 'squad') {
        for (const slot of ['PG', 'SG', 'SF', 'PF', 'C']) {
          await seat.page.getByTestId(`lobby-squad-slot-${slot}`).click();
          await spinPick(seat.page);
          await seat.page.getByRole('button', { name: `Save ${slot}`, exact: true }).click();
        }
        await seat.page.getByTestId('lobby-squad-submit').click();
      } else {
        await spinPick(seat.page);
        await seat.page.getByRole('button', { name: 'Submit build', exact: true }).click();
      }
      await seat.page.waitForFunction(
        () =>
          document.querySelector('[data-testid="building-state"]') ||
          document.querySelector('[data-testid="draw-team"]') ||
          document.querySelector('[data-testid="preview-ready"]'),
        null,
        { timeout: 30000 },
      );
    }
    if (recordMarks) mark('build-complete');
    await hostSeat.page.getByTestId('draw-team').waitFor();
    await hostSeat.page.getByTestId('draw-team').click();
    await hostSeat.page.getByTestId('reroll-team').waitFor();
    await hostSeat.page.getByTestId('reroll-team').click();
    await hostSeat.page.waitForTimeout(500);
    for (const seat of activeSeats.slice(1)) {
      await seat.page.getByTestId('draw-team').click();
      await seat.page.getByTestId('draw-team').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    }
    const lock = hostSeat.page.getByTestId('lock-teams');
    if (await lock.isVisible().catch(() => false)) await lock.click().catch(() => {});
    await hostSeat.page.getByTestId('preview-ready').waitFor();
    for (const seat of activeSeats) {
      const ready = seat.page.getByTestId('preview-ready');
      if (await ready.isEnabled().catch(() => false)) await ready.click().catch(() => {});
    }
    const startNow = hostSeat.page.getByTestId('start-season-now');
    if (await startNow.isVisible().catch(() => false)) await startNow.click().catch(() => {});
    await hostSeat.page.getByTestId('league-stage').waitFor();
    if (recordMarks) mark('season-start');
  };
  const chaos = { reload: reloadSeat, away: awaySeat, hostLeave };
  let code = null;
  let summaryWritten = false;
  try {
    let host = seats[0];
    await host.page.goto(base);
    await host.page.getByTestId('mp-name').waitFor({ timeout: 90000 });
    await host.page.getByTestId('mp-name').fill(host.name);
    await host.page.getByTestId('create-lobby').click();
    await host.page.getByTestId('lobby-code').waitFor();
    code = (await host.page.getByTestId('lobby-code').innerText()).trim();
    const link = (await host.page.getByTestId('lobby-invite-link').innerText()).trim();
    if (!state.lobbies.includes(code)) { state.lobbies.push(code); saveState(dir, state); }
    await snap(host, 'created');
    for (const seat of seats.slice(1)) {
      await seat.page.goto(link);
      await seat.page.getByTestId('invite-code').waitFor({ timeout: 90000 });
      await snap(seat, 'invite');
      await seat.page.getByTestId('invite-name').fill(seat.name);
      await seat.page.getByTestId('invite-join').click();
      await seat.page.getByTestId('lobby-code').waitFor({ timeout: 90000 });
      await snap(seat, 'joined');
    }
    await buildAndStart(host, seats, true, true);
    let checkpoint = 0;
    let chaosDone = false;
    let lastLabel = '';
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      for (const seat of active()) await recordSeries(seat);
      if (await visible(host, 'recap')) {
        const record = await verifyStage(`recap-${checkpoint}`, null);
        stages.push(record);
        mark('recap');
        break;
      }
      if (await visible(host, 'playoff-gate')) {
        const record = await verifyStage(`gate-${checkpoint}`, null);
        stages.push(record);
        if (!marks.some((entry) => entry.label === 'season-end')) mark('season-end');
        if (!marks.some((entry) => entry.label === 'playoff-gate')) mark('playoff-gate');
        await markRounds(host, record.roundName ?? record.stageName);
        for (const seat of active()) {
          if (await visible(seat, 'checkpoint')) throw new Error(`unexpected checkpoint at the playoff gate for seat ${seat.seat}`);
          if (!(await visible(seat, 'activity-log'))) throw new Error(`activity log missing at the playoff gate for seat ${seat.seat}`);
          const next = (await seat.page.getByTestId('next-action').innerText()).trim();
          if (!next) throw new Error(`next action missing at the playoff gate for seat ${seat.seat}`);
          await recordSeries(seat);
          await snap(seat, `gate-${checkpoint}`);
        }
        const gateLogs = await Promise.all(active().map(logText));
        if (new Set(gateLogs).size > 1) throw new Error('activity logs differ at the playoff gate');
        for (const seat of active()) await installSeriesObserver(seat);
        const gateAt = Date.now();
        const readyAt = new Map();
        for (const seat of active()) if (await clickReady(seat)) readyAt.set(seat.seat, Date.now());
        await host.page.getByTestId('playoff-gate').waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
        if (await visible(host, 'playoff-gate')) await startPlayoffs();
        await host.page.getByTestId('playoff-gate').waitFor({ state: 'hidden', timeout: 20000 });
        const advancedAt = Date.now();
        for (const seat of active()) {
          gateWaits.push({
            stage: 'Playoff gate',
            phase: 'Playoffs',
            seat: seat.seat,
            name: seat.name,
            gateMs: advancedAt - gateAt,
            afterReadyMs: readyAt.has(seat.seat) ? advancedAt - readyAt.get(seat.seat) : null,
          });
        }
        checkpoint++;
        lastLabel = '';
        continue;
      }
      const phase = await phaseOf(host).catch(() => '');
      const card = await stageName(host);
      const round = await roundName(host);
      const label = `${phase}:${round ?? card ?? ''}`;
      if (label !== lastLabel) {
        const record = await verifyStage(`stage-${checkpoint}`, null);
        stages.push(record);
        const roundLabel = clean(record.roundName ?? record.stageName ?? '').toUpperCase();
        if ((record.phase === 'Awards' || record.phase === 'Play-In' || record.phase === 'Playoffs') && !marks.some((entry) => entry.label === 'season-end')) mark('season-end');
        if (record.phase === 'Playoffs' && roundLabel === 'FIRST ROUND' && !marks.some((entry) => entry.label === 'playoff-gate')) mark('playoff-gate');
        await markRounds(host, record.roundName ?? record.stageName);
        if (record.phase === 'Awards' && !marks.some((entry) => entry.label === 'season-end')) mark('season-end');
        else if (record.phase === 'Play-In') {
          if (!marks.some((entry) => entry.label === 'season-end')) mark('season-end');
          mark('play-in');
        }
        else if (record.phase === 'Playoffs') {
          if (!marks.some((entry) => entry.label === 'season-end')) mark('season-end');
          if (roundLabel === 'FIRST ROUND' && !marks.some((entry) => entry.label === 'playoff-gate')) mark('playoff-gate');
          else mark(`round:${roundLabel}`);
        } else if (record.phase === 'Recap') mark('recap');
        for (const seat of active()) {
          if (await visible(seat, 'checkpoint')) throw new Error(`unexpected checkpoint at ${label} for seat ${seat.seat}`);
          if (!(await visible(seat, 'activity-log'))) throw new Error(`activity log missing at ${label} for seat ${seat.seat}`);
          await recordSeries(seat);
          await snap(seat, `stage-${checkpoint}`);
        }
        if (!chaosDone && checkpoint === 0) {
          chaosDone = true;
          if (reloadSeat !== null) {
            const seat = seats[reloadSeat - 1];
            reload.refreshedSeat = { seat: seat.seat, name: seat.name };
            await seat.page.reload({ waitUntil: 'load' });
            await waitStage(seat);
            await seat.page.getByTestId('standings').waitFor({ state: 'visible', timeout: 30000 });
            let common = null;
            let refreshedInvalid = false;
            for (let attempt = 0; attempt < 40; attempt++) {
              const reads = await Promise.all(active().map(async (entry) => ({ seat: entry, ...(await entry.page.evaluate(readLeagueStandings)) })));
              const refreshed = reads.find((entry) => entry.seat.seat === seat.seat && entry.seat.name === seat.name);
              if (!isValidRevision(refreshed?.revision)) {
                refreshedInvalid = true;
                if (await visible(seat, 'recap')) break;
                await host.page.waitForTimeout(250);
                continue;
              }
              refreshedInvalid = false;
              const result = compareStandings(reads, seat);
              if (!result.ok && result.reason.startsWith('standings differ')) throw new Error(result.reason);
              if (result.ok) common = result;
              if (common) break;
              await host.page.waitForTimeout(250);
            }
            if (!common) {
              if (refreshedInvalid) throw new Error(`refreshed seat ${seat.seat} has no valid displayed revision after reload (stage and progress required)`);
              throw new Error('no common standings revision after reload');
            }
            reload.ran = true;
            reload.revision = common.revision;
            reload.seats = common.seats;
            reload.rowsCompared = common.rowsCompared;
            stages.push({ label: 'after-reload', phase: await phaseOf(seat), revision: common.revision, seats: common.seats, standings: common.standings });
            await snap(seat, 'after-reload');
          }
          if (awaySeat !== null) {
            const seat = seats[awaySeat - 1];
            await seat.context.close();
            seat.closed = true;
            stages.push({ label: 'away', seat: seat.seat, name: seat.name });
          }
          if (hostLeave) {
            await host.page.getByTestId('quit-lobby').click();
            await host.page.waitForTimeout(1500);
            host.closed = true;
            stages.push({ label: 'host-left', seat: host.seat, name: host.name });
            host = active()[0];
          }
        }
        lastLabel = label;
        checkpoint++;
      }
      await host.page.waitForTimeout(100);
    }
    if (!marks.some((entry) => entry.label === 'recap')) throw new Error('league did not reach the recap');
    const champion = stages[stages.length - 1].champion;
    for (const seat of active()) await snap(seat, 'recap');
    const recapLogs = await Promise.all(active().map(logText));
    if (new Set(recapLogs).size > 1) throw new Error('activity logs differ at the recap');
    seriesScores.clear();
    const pollGaps = new Map();
    const seriesTimeline = new Map();
    for (const seat of active()) {
      const samples = await seat.page.evaluate(() => window.__seriesScores ?? []);
      seriesTimeline.set(`${seat.seat}:${seat.name}`, samples);
      let lastKey = null;
      for (const sample of samples) {
        const key = `${seat.seat}:${seat.name}`;
        if (sample.key !== lastKey) {
          seriesScores.set(key, new Set());
          lastKey = sample.key;
        }
        seriesScores.get(key).add(sample.score);
      }
      const polls = await seat.page.evaluate(() =>
        performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/lobby/')).map((entry) => entry.startTime + performance.timeOrigin),
      );
      const gaps = polls.slice(1).map((at, index) => at - polls[index]).sort((a, b) => a - b);
      const pick = (fraction) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * fraction))] ?? 0;
      pollGaps.set(`${seat.seat}:${seat.name}`, { p50: pick(0.5), p95: pick(0.95), max: gaps[gaps.length - 1] ?? 0 });
    }
    const seenSeries = [...seriesScores.values()].some((scores) => scores.size > 0);
    const movedSeries = [...seriesScores.values()].some((scores) => scores.size > 1);
    if (seenSeries && !movedSeries) throw new Error('human series card did not advance game by game');
    for (const [seat, scores] of seriesScores) {
      const totals = [...new Set([...scores].map((score) => score.split('-').reduce((sum, value) => sum + Number(value), 0)))].sort((a, b) => a - b);
      const max = totals[totals.length - 1] ?? 0;
      if (max < 4) continue;
      const samples = seriesTimeline.get(seat) ?? [];
      for (let index = 1; index < samples.length; index++) {
        if (samples[index].key !== samples[index - 1].key) continue;
        const previous = samples[index - 1].score.split('-').reduce((sum, value) => sum + Number(value), 0);
        const current = samples[index].score.split('-').reduce((sum, value) => sum + Number(value), 0);
        if (current < previous) throw new Error(`human series card went backwards for ${seat}: ${samples[index - 1].score} -> ${samples[index].score}`);
      }
      for (let index = 1; index < samples.length; index++) {
        if (samples[index].key === samples[index - 1].key) continue;
        const previous = samples[index - 1].score.split('-').reduce((sum, value) => sum + Number(value), 0);
        if (previous < 4) throw new Error(`human series card left an unfinished series for ${seat}: ${samples[index - 1].score}`);
      }
      const polls = await active().find((entry) => `${entry.seat}:${entry.name}` === seat)?.page.evaluate(() =>
        performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/lobby/')).map((entry) => entry.startTime + performance.timeOrigin),
      ) ?? [];
      const states = [];
      for (const sample of samples) {
        const total = sample.score.split('-').reduce((sum, value) => sum + Number(value), 0);
        if (!states.length || states[states.length - 1].total !== total) states.push({ total, at: sample.at });
      }
      for (let index = 1; index < states.length; index++) {
        if (states[index].total <= states[index - 1].total + 1) continue;
        const between = polls.filter((at) => at >= states[index - 1].at && at <= states[index].at);
        const gaps = [between[0] - states[index - 1].at, ...between.slice(1).map((at, i) => at - between[i]), states[index].at - between[between.length - 1]];
        if (Math.max(...gaps) <= 700) throw new Error(`human series card skipped a game for ${seat}: ${totals.join(',')}`);
      }
      if (totals[0] !== 0) throw new Error(`human series card skipped its first game for ${seat}`);
      for (const sample of samples) {
        if (sample.bracketScore && sample.score !== '0-0' && sample.bracketScore !== sample.score) {
          throw new Error(`my-matchup disagrees with the bracket for ${seat}: ${sample.score}`);
        }
      }
    }
    let playAgain = false;
    let rematchNote = null;
    let secondGameLog = null;
    const rematchHost = await findHost('rematch');
    if (rematchHost) {
      tap(rematchHost, 'Play Again');
      await rematchHost.page.getByTestId('rematch').click();
      await rematchHost.page.getByTestId('rematch-ready').waitFor();
      if (awaySeat !== null) {
        const away = seats[awaySeat - 1];
        const deadline = Date.now() + 75000;
        while (Date.now() < deadline) {
          const remove = rematchHost.page.getByRole('button', { name: 'Remove', exact: true }).first();
          if (await remove.isVisible().catch(() => false)) {
            await remove.click().catch(() => {});
            await rematchHost.page.getByText(`${away.name} is away`).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
            await rematchHost.page.getByTestId('rematch-ready').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
            rematchNote = 'away seat removed after the away window';
            break;
          }
          await rematchHost.page.waitForTimeout(2000);
        }
      }
      if (players === 2 && awaySeat !== null) {
        await rematchHost.page.getByTestId('rematch-needs-players').waitFor({ timeout: 15000 });
        const invite = await rematchHost.page.getByTestId('rematch-invite-link').innerText();
        if (!invite.includes(code)) throw new Error('rematch invite link is missing the lobby code');
        rematchNote = 'only one player remains; invite shown';
      } else {
        for (const seat of active()) {
          const ready = seat.page.getByTestId('rematch-ready');
          if (await ready.isEnabled().catch(() => false)) {
            tap(seat, 'Rematch Ready');
            await ready.click().catch(() => {});
          }
        }
        const start = rematchHost.page.getByTestId('rematch-start');
        if (await start.isEnabled().catch(() => false)) {
          tap(rematchHost, 'Rematch Start');
          await start.click().catch(() => {});
        }
        await rematchHost.page.getByTestId('open-builder').waitFor({ timeout: 30000 });
        for (const seat of active()) await snap(seat, 'second-game');
        await buildAndStart(rematchHost, active(), false, false);
        const secondDeadline = Date.now() + 45000;
        while (Date.now() < secondDeadline) {
          if ((await visible(rematchHost, 'awards')) || (await visible(rematchHost, 'playoffs')) || (await visible(rematchHost, 'recap'))) break;
          await rematchHost.page.waitForTimeout(250);
        }
        secondGameLog = await rematchHost.page.getByTestId('activity-log').innerText().catch(() => '');
        for (const seat of active()) await snap(seat, 'second-game-events');
        playAgain = true;
      }
    }
    const timed = stages.filter((entry) => entry.at);
    const phaseTimings = timed.map((entry, index) => ({
      phase: entry.phase,
      stage: entry.stageName,
      seconds: index + 1 < timed.length ? Math.round((timed[index + 1].at - entry.at) / 1000) : null,
    }));
    const phaseDurations = marks.slice(1).map((entry, index) => ({
      from: marks[index].label,
      to: entry.label,
      seconds: Math.round((entry.at - marks[index].at) / 1000),
    }));
    const actions = seats.map((seat) => ({ seat: seat.seat, name: seat.name, actions: seat.actions }));
    const gateWaitTotals = seats.map((seat) => ({
      seat: seat.seat,
      name: seat.name,
      gateMs: gateWaits.filter((entry) => entry.seat === seat.seat).reduce((sum, entry) => sum + entry.gateMs, 0),
      afterReadyMs: gateWaits.filter((entry) => entry.seat === seat.seat).reduce((sum, entry) => sum + (entry.afterReadyMs ?? 0), 0),
    }));
    const apiLatency = [...apiSamples.entries()]
      .map(([endpoint, sample]) => ({
        endpoint,
        count: sample.ms.length,
        p50: median(sample.ms),
        p95: pct(sample.ms, 95),
        max: Math.max(...sample.ms),
        status: sample.status,
      }))
      .sort((a, b) => a.endpoint.localeCompare(b.endpoint));
    const summary = {
      code,
      players,
      mode,
      era,
      device: o.device ?? 'iphone',
      viewport,
      chaos,
      reload,
      stages,
      phaseTimings,
      phaseDurations,
      marks,
      actions,
      gateWaits,
      gateWaitTotals,
      seriesScores: Object.fromEntries([...seriesScores].map(([seat, scores]) => [seat, [...scores]])),
      seriesTimeline: Object.fromEntries(seriesTimeline),
      pollGaps: Object.fromEntries(pollGaps),
      apiLatency,
      champion,
      playAgain,
      rematchNote,
      secondGameLog,
      errors: seats.map((seat) => ({ seat: seat.seat, name: seat.name, errors: seat.errors })),
      httpErrors: seats.map((seat) => ({ seat: seat.seat, name: seat.name, responses: seat.http })),
      evidence: ev,
    };
    summary.reload = reloadRecord(reloadSeat !== null, reload);
    fs.writeFileSync(path.join(ev, 'summary.json'), JSON.stringify(summary, null, 2));
    summaryWritten = true;
    console.log(JSON.stringify({ code, players, mode, era, device: o.device ?? 'iphone', viewport, chaos, reload: summary.reload, stages: stages.filter((entry) => entry.phase).length, phaseDurations, actions, gateWaitTotals, apiLatency, champion, playAgain, rematchNote, secondGameLog, errors: summary.errors.filter((entry) => entry.errors.length), evidence: ev, summary: path.join(ev, 'summary.json') }, null, 2));
    if (summary.reload.coverage !== 'ok') throw new Error(`refresh coverage missing: ${summary.reload.coverage}`);
  } catch (error) {
    if (!summaryWritten) {
      const failure = leagueFailureSummary({ error, code, players, mode, era, device: o.device ?? 'iphone', viewport, chaos, reloadRequested: reloadSeat !== null, reload, evidence: ev, at: new Date().toISOString() });
      fs.writeFileSync(path.join(ev, 'summary.json'), JSON.stringify(failure, null, 2));
    }
    throw error;
  } finally {
    await browser.close();
  }
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
  let engine = null;
  let spinTarget = null;
  const loadEngine = async () => {
    if (spinTarget) return spinTarget;
    engine = await (await import('vite')).createServer({ configFile: false, root: repo, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
    spinTarget = (await engine.ssrLoadModule('/src/shared/engine/spin.ts')).spinTarget;
    return spinTarget;
  };
  const buildFor = (participant) => {
    if (!participant.buildSeed) return null;
    const picks = {};
    const spins = [];
    for (let index = 0; index < GUARD_ATTRS.length; index++) {
      const target = spinTarget(guardPool, participant.buildSeed, index, false, 0, `${participant.buildSeed}:r`);
      if (!target) return null;
      const attr = GUARD_ATTRS[index];
      picks[attr] = { attr, val: target.player.attrs[attr] ?? 0, playerName: target.player.name, playerShort: target.player.short ?? target.player.name, team: target.player.team };
      spins.push({ attr, team: target.team, playerName: target.player.name, teamRespin: false, playerRespin: false });
    }
    return { kind: 'normal', position: 'guard', era: 'current', picks, spins };
  };
  const absorb = (p, lobby, delta) => {
    if (lobby) {
      p.version = lobby.version;
      p.events = lobby.events[0]?.id ?? 0;
      if (lobby.me?.seat) p.seat = lobby.me.seat;
      if (lobby.me?.buildSeed) p.buildSeed = lobby.me.buildSeed;
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
  const started = await api(base, 'POST', `/api/lobby/${code}/start`, host.secret, { actionId: randomUUID(), settings: { era: 'current', mode: 'normal' } });
  add('start', started);
  if (started.status >= 300) throw new Error(`start ${started.status} ${JSON.stringify(started.json)}`);
  absorb(host, started.json?.lobby);
  const stopAt = Date.now() + seconds * 1000;
  if (o.drafts !== 'off') await loadEngine();
  try {
    await Promise.all(seated.map(async (p, idx) => {
      let draftTick = 0;
      while (Date.now() < stopAt) {
        const query = new URLSearchParams({ since: String(p.version), events: String(p.events) });
        if (p.token) query.set('token', p.token);
        const r = await api(base, 'GET', `/api/lobby/${code}?${query.toString()}`, p.secret);
        add(r.status === 204 ? 'poll-204' : r.json?.delta ? 'poll-200-delta' : 'poll-200', r);
        absorb(p, r.json?.lobby, r.json?.delta);
        if (o.drafts !== 'off' && p.buildSeed && p.filled.get(p.seat) !== 10 && ++draftTick % 3 === idx % 3) {
          const build = buildFor(p);
          if (build) {
            const d = await api(base, 'POST', `/api/lobby/${code}/build`, p.secret, { actionId: randomUUID(), build });
            add('build-sync', d);
            absorb(p, d.json?.lobby);
          }
        }
        await sleep(pollMs);
      }
    }));
  } finally {
    if (engine) await engine.close();
  }
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
  if (!state.localDb && state.lobbies.length && state.mode === 'dev') {
    const outText = execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'drop-lobbies.ts'), ...state.lobbies], { cwd: repo, encoding: 'utf8' });
    removed = JSON.parse(outText);
  }
  if (state.localDb) await localDb.stopLocalDb({ ...state.localDb, remove: true });
  fs.rmSync(path.join(home, 'current'), { force: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith('session-')) fs.rmSync(path.join(dir, f));
  const evidence = path.join(dir, 'evidence');
  console.log(JSON.stringify({ stopped: killed, portFree: portOwner(state.port).length === 0, lobbiesRemoved: removed, evidence, evidenceFiles: fs.readdirSync(evidence, { recursive: true }).length }, null, 2));
}

async function perf() {
  const run = o.out || o.base ? null : currentRun();
  const out = o.out ?? (run ? evidenceDir(run.dir, 'perf') : path.join(repo, 'evidence', 'perf'));
  const args = [path.join(repo, '.claude/skills/verify-build-a-bucket/scripts/meter/run.mjs'), '--out', out];
  for (const key of ['runs', 'seconds', 'fresh-gap', 'modes', 'journeys', 'tag', 'repo', 'schema', 'pg-port', 'port']) {
    if (o[key] !== undefined) args.push(`--${key}`, String(o[key]));
  }
  const child = spawn(process.execPath, args, { cwd: repo, stdio: 'inherit' });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  if (code !== 0) process.exitCode = code;
}

const table = { launch, doctor, ui, league: leagueRun, 'lobby-load': lobbyLoad, 'cold-load': coldLoad, perf, cleanup };
if (!table[cmd]) { console.error('usage: control.mjs launch [--port N] [--prod] | doctor | ui --feature F [--device iphone|pixel] [--viewport 390x844] [--session S] [--path /] --step ... | league [--players 2..8] [--mode normal|salary|squad] [--era current|alltime] [--device iphone|pixel] [--viewport WxH] [--reload SEAT] [--away SEAT] [--host-leave] [--base URL] | lobby-load [--players 8] [--extra 4] [--seconds 20] [--poll 1000] [--base URL] [--drafts off] | cold-load [--url URL] [--runs 5] [--visits 2] | perf [--runs 3] [--seconds 20] [--modes normal,salary,squad] [--journeys solo,idle,league] [--tag name] [--out DIR] | cleanup'); process.exit(2); }
await table[cmd]();
