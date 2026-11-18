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
  let finalized = false;
  let outcome = null;
  let recorder = null;
  let spawnError = null;
  let failure = null;
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
  const message = (error) => (error instanceof Error ? error.message : String(error));
  const recordOutcome = (child) => {
    const record = { exited: false, code: null, signal: null, errors: [], exitedBeforeShutdown: false, killedByUs: false };
    const onExit = (code, signal) => {
      if (record.exited) return;
      record.exited = true;
      record.code = code;
      record.signal = signal;
    };
    const onError = (error) => {
      record.errors.push(message(error));
    };
    child.on('exit', onExit);
    child.on('error', onError);
    if (child.exitCode !== null || child.signalCode !== null) {
      record.exited = true;
      record.code = child.exitCode;
      record.signal = child.signalCode;
    }
    return {
      record,
      dispose: () => {
        child.removeListener('exit', onExit);
        child.removeListener('error', onError);
      },
    };
  };
  const waitOutcome = (timeoutMs) => {
    const child = active?.testChild;
    let done = false;
    let timer = null;
    let resolveFn;
    const promise = new Promise((resolve) => {
      resolveFn = resolve;
    });
    const finish = (value) => {
      if (done) return;
      done = true;
      if (timer) clock.clearTimeout(timer);
      if (child) child.removeListener('exit', onExit);
      resolveFn(value);
    };
    const onExit = () => finish(true);
    if (child) child.on('exit', onExit);
    if (outcome?.exited) finish(true);
    else if (timeoutMs > 0) timer = clock.setTimeout(() => finish(false), timeoutMs);
    return {
      promise,
      dispose: () => {
        if (!done) {
          done = true;
          if (timer) clock.clearTimeout(timer);
          if (child) child.removeListener('exit', onExit);
        }
      },
    };
  };
  const stopCommand = async () => {
    const child = active?.testChild;
    if (!child || !outcome) return;
    if (outcome.exited) return;
    try {
      child.kill('SIGTERM');
      outcome.killedByUs = true;
    } catch (error) {
      outcome.errors.push(message(error));
    }
    const term = waitOutcome(10000);
    if (await term.promise) return;
    try {
      child.kill('SIGKILL');
      outcome.killedByUs = true;
    } catch (error) {
      outcome.errors.push(message(error));
    }
    const kill = waitOutcome(5000);
    await kill.promise;
  };
  const finalize = (dbResult) => {
    if (finalized) return;
    finalized = true;
    if (recorder) recorder.dispose();
    const command = spawnError
      ? { state: 'spawn-error', code: null, signal: null, reason: spawnError, errors: [spawnError], error: spawnError }
      : failure
        ? { state: outcome ? (outcome.exited ? 'exited' : 'uncertain') : 'not-started', code: outcome?.code ?? null, signal: outcome?.signal ?? null, reason: failure, errors: outcome ? [...outcome.errors] : [], error: failure }
        : outcome
          ? { state: outcome.exited ? 'exited' : 'uncertain', code: outcome.code, signal: outcome.signal, reason: outcome.exited ? null : 'command did not exit', errors: [...outcome.errors], error: outcome.errors[0] ?? null }
          : { state: 'not-started', code: null, signal: null, reason: null, errors: [], error: null };
    const cleanExit = !failure && (command.state === 'not-started' || (command.state === 'exited' && command.errors.length === 0 && (command.code === 0 || (outcome.killedByUs && !outcome.exitedBeforeShutdown))));
    const ok = dbResult.state === 'clean' && cleanExit;
    writeReceipt(ok, command.reason ?? command.error ?? dbResult.reason, [dbResult], command);
    if (ok && active?.handle?.remove) {
      fs.rmSync(active.handle.dataDir, { recursive: true, force: true });
      fs.rmSync(active.handle.sockDir, { recursive: true, force: true });
      if (active.handle.createdRoot) {
        try {
          fs.rmdirSync(active.handle.dataRoot);
        } catch {}
      }
    }
    const exitCode = ok && !shutdownPromise ? 0 : (!failure && command.state === 'exited' && !outcome.killedByUs && typeof command.code === 'number' && command.code !== 0 ? command.code : 1);
    callExit(exitCode);
  };
  const shutdown = async () => {
    await stopCommand();
    const result = await stopPostgres();
    finalize(result);
  };
  let shutdownPromise = null;
  let resolveShutdown;
  const shutdownSignal = new Promise((resolve) => {
    resolveShutdown = resolve;
  });
  const onSignal = () => {
    if (!shutdownPromise) {
      if (outcome) outcome.exitedBeforeShutdown = outcome.exited;
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
    recorder = recordOutcome(testChild);
    outcome = recorder.record;
    let resolveSpawnError;
    const spawnErrorSignal = new Promise((resolve) => {
      resolveSpawnError = resolve;
    });
    onTestError = (error) => {
      if (testChild.pid === undefined || testChild.pid === null) {
        spawnError = message(error);
        resolveSpawnError();
      }
    };
    testChild.once('error', onTestError);
    const watch = waitOutcome(0);
    await Promise.race([watch.promise, shutdownSignal, spawnErrorSignal]);
    if (shutdownPromise) {
      watch.dispose();
      await shutdownPromise;
      return;
    }
    if (spawnError) {
      watch.dispose();
      const result = await stopPostgres();
      finalize(result);
      return;
    }
    watch.dispose();
    const result = await stopPostgres();
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }
    finalize(result);
  } catch (error) {
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }
    failure = message(error);
    const result = await stopPostgres();
    finalize(result);
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
