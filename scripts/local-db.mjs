import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as realSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createOwnedPostgres, ownedPostgresEnv } from '../.claude/skills/verify-build-a-bucket/scripts/owned-postgres.mjs';
import { descendants, groupMembers, probePid, probePort, readProcessIdentity } from '../.claude/skills/verify-build-a-bucket/scripts/process-control.mjs';
import { stopService, waitForExit } from '../.claude/skills/verify-build-a-bucket/scripts/supervisor.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(REPO, '.claude/skills/verify-build-a-bucket/scripts/meter/local-pg.mjs');

function controls(clock = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, clearTimeout: globalThis.clearTimeout }) {
  return { readIdentity: readProcessIdentity, groupMembers, descendants, probe: probePid, probePort, clock };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

export function localDbEnv(handle) {
  return ownedPostgresEnv(handle);
}

export function createStopOnce(stop) {
  let promise = null;
  return () => {
    if (!promise) promise = stop();
    return promise;
  };
}

export async function startLocalDb(options = {}) {
  const root = options.root ?? REPO;
  const port = Number(options.pgPort ?? process.env.BAB_LOCAL_PG_PORT ?? 55434);
  const database = options.database ?? 'bab_local';
  const schema = options.schema ?? path.join(root, 'db', 'schema.sql');
  const createdRoot = options.dataRoot === undefined;
  const dataRoot = options.dataRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'bab-local-db-'));
  const owned = await createOwnedPostgres({
    root: dataRoot,
    port,
    database,
    schema,
    spawn: options.spawn,
    psql: options.psql,
    initdb: options.initdb,
    schemaLoad: options.schemaLoad,
    clock: options.clock,
    onChild: options.onChild,
    logPath: options.logPath,
  });
  return { ...owned, root, dataRoot, createdRoot, runnerPath: RUNNER, remove: options.remove ?? true };
}

export async function stopLocalDb(handle, clock) {
  if (!handle?.child) return { state: 'clean', reason: null };
  const result = await stopService({ service: { name: 'postgres', kind: 'postgres', port: handle.port }, child: handle.child, controls: controls(clock) });
  if (result.state === 'clean' && handle.remove) {
    fs.rmSync(handle.dataDir, { recursive: true, force: true });
    fs.rmSync(handle.sockDir, { recursive: true, force: true });
    if (handle.createdRoot) {
      try {
        fs.rmdirSync(handle.dataRoot);
      } catch {}
    }
  }
  return result;
}

export async function main({
  argv = process.argv.slice(2),
  spawn = realSpawn,
  psql,
  initdb,
  schemaLoad,
  clock = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, clearTimeout: globalThis.clearTimeout },
  receiptPath = process.env.BAB_LOCAL_DB_RECEIPT,
  signals = process,
  exit = (code) => {
    process.exitCode = code;
  },
} = {}) {
  const split = argv.indexOf('--');
  if (split < 0 || split === argv.length - 1) throw new Error('usage: node scripts/local-db.mjs [--pg-port N] [--data-dir DIR] [--keep] -- <command...>');
  const flags = argv.slice(0, split);
  const command = argv.slice(split + 1);
  const value = (name, fallback) => {
    const index = flags.indexOf(`--${name}`);
    return index >= 0 ? flags[index + 1] ?? fallback : fallback;
  };
  let active = null;
  const stopPostgres = createStopOnce(() => {
    if (active?.handle) return stopService({ service: { name: 'postgres', kind: 'postgres', port: active.handle.port }, child: active.handle.child, controls: controls(clock) });
    if (active?.child) return stopService({ service: { name: 'postgres', kind: 'postgres', port: active.port }, child: active.child, controls: controls(clock) });
    return Promise.resolve({ state: 'clean', reason: null });
  });
  let receiptWritten = false;
  let exitCalled = false;
  const writeReceipt = (ok, reason, services, command) => {
    if (receiptWritten) return;
    receiptWritten = true;
    if (receiptPath) writeJson(receiptPath, { ok, reason, services, command });
  };
  const callExit = (code) => {
    if (exitCalled) return;
    exitCalled = true;
    exit(code);
  };
  const stopCommand = async () => {
    const child = active?.testChild;
    if (!child) return { state: 'exited', code: null, signal: null };
    if (child.exitCode !== null || child.signalCode !== null) return { state: 'exited', code: child.exitCode, signal: child.signalCode };
    child.kill('SIGTERM');
    const term = await waitForExit(child, 10000, clock);
    if (term) return { state: 'exited', code: term.code, signal: term.signal };
    child.kill('SIGKILL');
    const kill = await waitForExit(child, 5000, clock);
    if (kill) return { state: 'exited', code: kill.code, signal: kill.signal };
    return { state: 'uncertain', reason: 'command did not exit' };
  };
  const shutdown = async () => {
    const command = await stopCommand();
    const result = await stopPostgres();
    const ok = result.state === 'clean' && command.state === 'exited';
    writeReceipt(ok, command.reason ?? result.reason, [result], { state: command.state, reason: command.reason ?? null });
    if (ok && active?.handle?.remove) {
      fs.rmSync(active.handle.dataDir, { recursive: true, force: true });
      fs.rmSync(active.handle.sockDir, { recursive: true, force: true });
      if (active.handle.createdRoot) {
        try {
          fs.rmdirSync(active.handle.dataRoot);
        } catch {}
      }
    }
    callExit(1);
  };
  let shutdownPromise = null;
  let resolveShutdown;
  const shutdownSignal = new Promise((resolve) => {
    resolveShutdown = resolve;
  });
  const onSignal = () => {
    if (!shutdownPromise) {
      shutdownPromise = shutdown();
      resolveShutdown();
    }
  };
  signals.on('SIGINT', onSignal);
  signals.on('SIGTERM', onSignal);
  try {
    const handle = await startLocalDb({
      pgPort: value('pg-port', process.env.BAB_LOCAL_PG_PORT ?? 55434),
      dataRoot: value('data-dir', undefined),
      remove: !flags.includes('--keep'),
      spawn,
      psql,
      initdb,
      schemaLoad,
      clock,
      onChild: (child, port) => {
        active = { ...(active ?? {}), child, port };
      },
    });
    active = { ...(active ?? {}), handle };
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }
    const testChild = spawn(command[0], command.slice(1), { cwd: handle.root, env: { ...process.env, ...localDbEnv(handle) }, stdio: 'inherit' });
    active.testChild = testChild;
    let testError = null;
    testChild.once('error', (error) => {
      testError = error;
    });
    testChild.once('exit', () => {});
    const exitResult = await Promise.race([waitForExit(testChild, 0, clock), shutdownSignal]);
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }
    const result = await stopPostgres();
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }
    const ok = result.state === 'clean' && !testError && !exitResult?.error;
    writeReceipt(ok, testError?.message ?? exitResult?.error?.message, [result], { state: 'exited', code: exitResult?.code ?? null, signal: exitResult?.signal ?? null });
    if (ok && handle.remove) {
      fs.rmSync(handle.dataDir, { recursive: true, force: true });
      fs.rmSync(handle.sockDir, { recursive: true, force: true });
      if (handle.createdRoot) {
        try {
          fs.rmdirSync(handle.dataRoot);
        } catch {}
      }
    }
    callExit(ok ? (exitResult?.code ?? 1) : 1);
  } catch (error) {
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }
    const result = await stopPostgres();
    writeReceipt(false, error instanceof Error ? error.message : String(error), [result], { state: 'exited', code: null, signal: null });
    callExit(1);
  } finally {
    signals.removeListener('SIGINT', onSignal);
    signals.removeListener('SIGTERM', onSignal);
    if (shutdownPromise) await shutdownPromise;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
