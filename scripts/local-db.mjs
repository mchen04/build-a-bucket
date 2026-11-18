import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as realSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createOwnedPostgres, ownedPostgresEnv } from '../.claude/skills/verify-build-a-bucket/scripts/owned-postgres.mjs';
import { descendants, groupMembers, probePid, probePort, readProcessIdentity } from '../.claude/skills/verify-build-a-bucket/scripts/process-control.mjs';
import { stopService } from '../.claude/skills/verify-build-a-bucket/scripts/supervisor.mjs';

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
  const watchExit = (child) => {
    let settled = false;
    let error = null;
    let timer = null;
    let resolveFn;
    const promise = new Promise((resolve) => {
      resolveFn = resolve;
    });
    const cleanup = () => {
      if (timer) clock.clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
    };
    const settle = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveFn(value);
    };
    const onExit = (code, signal) => settle({ code, signal });
    const onError = (err) => {
      error = err;
    };
    child.on('exit', onExit);
    child.on('error', onError);
    if (child.exitCode !== null || child.signalCode !== null) settle({ code: child.exitCode, signal: child.signalCode });
    return {
      promise,
      start: (timeoutMs) => {
        if (settled) return;
        if (timeoutMs > 0) timer = clock.setTimeout(() => settle(null), timeoutMs);
      },
      dispose: () => {
        if (!settled) {
          settled = true;
          cleanup();
        }
      },
      error: () => error,
    };
  };
  const stopCommand = async () => {
    const child = active?.testChild;
    if (!child) return { state: 'exited', code: null, signal: null };
    if (child.exitCode !== null || child.signalCode !== null) return { state: 'exited', code: child.exitCode, signal: child.signalCode };
    let killError = null;
    const term = watchExit(child);
    try {
      child.kill('SIGTERM');
    } catch (err) {
      killError = err;
    }
    term.start(10000);
    const termResult = await term.promise;
    if (termResult) return { state: 'exited', code: termResult.code, signal: termResult.signal, error: term.error()?.message };
    const kill = watchExit(child);
    try {
      child.kill('SIGKILL');
    } catch (err) {
      killError = err;
    }
    kill.start(5000);
    const killResult = await kill.promise;
    if (killResult) return { state: 'exited', code: killResult.code, signal: killResult.signal, error: kill.error()?.message };
    return { state: 'uncertain', reason: 'command did not exit', error: (killError ?? term.error() ?? kill.error())?.message };
  };
  const shutdown = async () => {
    const command = await stopCommand();
    const result = await stopPostgres();
    const ok = result.state === 'clean' && command.state === 'exited' && !command.error;
    writeReceipt(ok, command.reason ?? command.error ?? result.reason, [result], { state: command.state, reason: command.reason ?? null, error: command.error ?? null });
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
  let testChild = null;
  let onTestError = null;
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
    testChild = spawn(command[0], command.slice(1), { cwd: handle.root, env: { ...process.env, ...localDbEnv(handle) }, stdio: 'inherit' });
    active.testChild = testChild;
    let testError = null;
    let resolveSpawnError;
    const spawnErrorSignal = new Promise((resolve) => {
      resolveSpawnError = resolve;
    });
    onTestError = (error) => {
      testError = error;
      if (testChild.pid === undefined || testChild.pid === null) resolveSpawnError();
    };
    testChild.once('error', onTestError);
    const watch = watchExit(testChild);
    const exitResult = await Promise.race([watch.promise, shutdownSignal, spawnErrorSignal]);
    if (shutdownPromise) {
      watch.dispose();
      await shutdownPromise;
      return;
    }
    if (testError && (testChild.pid === undefined || testChild.pid === null)) {
      watch.dispose();
      const result = await stopPostgres();
      writeReceipt(false, testError.message, [result], { state: 'spawn-error', reason: testError.message });
      callExit(1);
      return;
    }
    watch.dispose();
    const commandError = watch.error();
    const result = await stopPostgres();
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }
    const ok = result.state === 'clean' && !commandError && !exitResult?.error && exitResult?.code === 0;
    writeReceipt(ok, commandError?.message ?? exitResult?.error?.message, [result], { state: 'exited', code: exitResult?.code ?? null, signal: exitResult?.signal ?? null, error: commandError?.message ?? null });
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
    if (testChild && onTestError) testChild.removeListener('error', onTestError);
    if (shutdownPromise) await shutdownPromise;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
