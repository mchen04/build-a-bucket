import fs from 'node:fs';
import path from 'node:path';
import { spawn as realSpawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createOwnedPostgres } from './owned-postgres.mjs';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function waitForExit(child, timeoutMs, clock) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    child.once('exit', (code, signal) => finish({ code, signal }));
    child.once('error', (error) => finish({ error }));
    if (timeoutMs > 0) clock.setTimeout(() => finish(null), timeoutMs);
  });
}

function alreadyExited(child) {
  if (child.exitCode !== null && child.exitCode !== undefined) return { code: child.exitCode, signal: child.signalCode ?? null };
  if (child.signalCode) return { code: null, signal: child.signalCode };
  return null;
}

export async function stopService({ service, child, controls }) {
  if (child.pid === undefined || child.pid === null || child.spawnError) {
    return { name: service.name, pid: child.pid ?? null, state: 'uncertain', reason: 'not started' };
  }
  const { groupMembers, descendants, probe, probePort, clock } = controls;
  const group = groupMembers(child.pid);
  const tree = descendants ? descendants(child.pid) : { ok: true, pids: [] };
  if (!group.ok || !tree.ok) return { name: service.name, pid: child.pid, state: 'uncertain', reason: 'descendant enumeration failed' };
  const pids = [...new Set([...group.members.map((member) => member.pid), ...tree.pids])].filter((pid) => pid !== child.pid);
  const exited = alreadyExited(child);
  if (service.kind === 'postgres') {
    if (exited) {
      if (exited.code !== 0) return { name: service.name, pid: child.pid, state: 'uncertain', reason: `postmaster exit ${exited.code ?? exited.signal}` };
      const portState = probePort(service.port);
      if (portState !== 'absent') return { name: service.name, pid: child.pid, state: 'uncertain', reason: `postgres port ${portState}` };
      return { name: service.name, pid: child.pid, state: 'clean', reason: null };
    }
    child.kill('SIGINT');
    const exit = await waitForExit(child, 30000, clock);
    if (!exit) return { name: service.name, pid: child.pid, state: 'uncertain', reason: 'postmaster did not exit within 30s' };
    if (exit.code !== 0) return { name: service.name, pid: child.pid, state: 'uncertain', reason: `postmaster exit ${exit.code ?? exit.signal}` };
    const portState = probePort(service.port);
    if (portState !== 'absent') return { name: service.name, pid: child.pid, state: 'uncertain', reason: `postgres port ${portState}` };
    return { name: service.name, pid: child.pid, state: 'clean', reason: null };
  }
  if (!exited) {
    child.kill('SIGTERM');
    let exit = await waitForExit(child, 10000, clock);
    if (!exit) {
      child.kill('SIGKILL');
      exit = await waitForExit(child, 5000, clock);
    }
    if (!exit) return { name: service.name, pid: child.pid, state: 'uncertain', reason: 'app did not exit' };
  }
  const deadline = 5000;
  const interval = 200;
  let elapsed = 0;
  while (true) {
    const states = pids.map((pid) => ({ pid, state: probe(pid) }));
    const unknown = states.find((entry) => entry.state !== 'present' && entry.state !== 'absent');
    if (unknown) return { name: service.name, pid: child.pid, state: 'uncertain', reason: `descendant ${unknown.pid} probe ${unknown.state}` };
    const live = states.filter((entry) => entry.state === 'present').map((entry) => entry.pid);
    const groupAfter = groupMembers(child.pid);
    if (!groupAfter.ok) return { name: service.name, pid: child.pid, state: 'uncertain', reason: 'group enumeration failed' };
    const groupStates = groupAfter.members.filter((member) => member.pid !== child.pid).map((member) => ({ pid: member.pid, state: probe(member.pid) }));
    const groupUnknown = groupStates.find((entry) => entry.state !== 'present' && entry.state !== 'absent');
    if (groupUnknown) return { name: service.name, pid: child.pid, state: 'uncertain', reason: `group member ${groupUnknown.pid} probe ${groupUnknown.state}` };
    const groupLive = groupStates.filter((entry) => entry.state === 'present').map((entry) => entry.pid);
    if (!live.length && !groupLive.length) return { name: service.name, pid: child.pid, state: 'clean', reason: null };
    if (elapsed >= deadline) return { name: service.name, pid: child.pid, state: 'uncertain', reason: `descendants live: ${[...live, ...groupLive].join(',')}` };
    await new Promise((resolve) => clock.setTimeout(resolve, interval));
    elapsed += interval;
  }
}

export async function startSupervisor({
  runDir,
  services,
  controlPath,
  receiptPath,
  ackPath,
  postgresInit,
  spawn = realSpawn,
  clock = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, clearTimeout: globalThis.clearTimeout },
  controls,
  handoffMs = 180000,
  exit = process.exit,
  onFail,
}) {
  const children = [];
  let postgres = null;
  let postgresChild = null;
  let postgresPort = null;
  let stopping = false;
  let stopPromise = null;
  let poll = null;
  let handoff = null;
  const stopPostgres = async () => {
    if (postgres) return stopService({ service: { name: 'postgres', kind: 'postgres', port: postgres.port }, child: postgres.child, controls });
    if (postgresChild) return stopService({ service: { name: 'postgres', kind: 'postgres', port: postgresPort }, child: postgresChild, controls });
    return null;
  };
  const stop = () => {
    if (!stopPromise) {
      stopping = true;
      stopPromise = (async () => {
        if (poll) clock.clearInterval(poll);
        if (handoff) clock.clearTimeout(handoff);
        const results = [];
        const pg = await stopPostgres();
        if (pg) results.push(pg);
        for (const { service, child } of children) results.push(await stopService({ service, child, controls }));
        writeJson(receiptPath, { ok: results.every((result) => result.state === 'clean'), services: results });
        exit(0);
        return results;
      })();
    }
    return stopPromise;
  };
  const fail = (error) => {
    if (!stopPromise) {
      stopping = true;
      stopPromise = (async () => {
        if (poll) clock.clearInterval(poll);
        if (handoff) clock.clearTimeout(handoff);
        const reason = error instanceof Error ? error.message : String(error);
        const results = [];
        const pg = await stopPostgres();
        if (pg) results.push(pg);
        for (const { service, child } of children) results.push(await stopService({ service, child, controls }));
        writeJson(path.join(runDir, 'supervisor-init.json'), { state: 'failed', reason });
        writeJson(receiptPath, { ok: false, reason, services: results });
        exit(1);
        return results;
      })();
    }
    return stopPromise;
  };
  if (onFail) onFail(fail);
  try {
    if (postgresInit) {
      postgres = await createOwnedPostgres({
        ...postgresInit,
        spawn,
        clock,
        onChild: (child, port) => {
          postgresChild = child;
          postgresPort = port;
          child.on('error', (error) => fail(error));
          child.on('exit', (code, signal) => {
            if (!stopping && code !== 0) fail(new Error(`postgres exited ${code ?? signal}`));
          });
        },
      });
      writeJson(path.join(runDir, 'supervisor-init.json'), { state: 'initialized', database: postgres.database, dataDir: postgres.dataDir, sockDir: postgres.sockDir });
    }
    for (const service of services) {
      const stdio = service.logPath ? ['ignore', fs.openSync(service.logPath, 'a'), fs.openSync(service.logPath, 'a')] : (service.stdio ?? 'ignore');
      const env = { ...process.env, ...(service.env ?? {}), ...(service.envFromPostgres && postgres ? postgres.env : {}) };
      const child = spawn(service.command, service.args, { cwd: service.cwd, env, stdio, detached: service.detached ?? false });
      child.on('error', (error) => fail(error));
      child.on('exit', (code, signal) => {
        if (!stopping && code !== 0) fail(new Error(`service ${service.name} exited ${code ?? signal}`));
      });
      children.push({ service, child });
    }
  } catch (error) {
    await fail(error);
    return { children, stop, fail };
  }
  writeJson(path.join(runDir, 'supervisor.json'), { pid: process.pid, controlPath, receiptPath, ackPath, services: children.map(({ service, child }) => ({ name: service.name, pid: child.pid })) });
  poll = clock.setInterval(() => {
    if (fs.existsSync(controlPath)) {
      clock.clearInterval(poll);
      stop();
    }
  }, 250);
  handoff = clock.setTimeout(() => {
    if (!fs.existsSync(ackPath)) stop();
  }, handoffMs);
  return { children, stop, fail };
}

export async function requestStop({ controlPath, receiptPath, timeoutMs = 60000, clock = { setTimeout: globalThis.setTimeout } }) {
  writeJson(controlPath, { command: 'stop' });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = readJson(receiptPath);
    if (receipt) return receipt;
    await new Promise((resolve) => clock.setTimeout(resolve, 250));
  }
  return { ok: false, services: [], reason: 'supervisor receipt timeout' };
}

export async function runSupervised({ services = [], children = null, command, commandEnv, commandCwd, controls, receiptPath, onTestChild }) {
  const owned = children ?? services.map((service) => ({ service, child: controls.spawn(service.command, service.args, { cwd: service.cwd, env: service.env, stdio: service.stdio ?? 'inherit' }) }));
  let exit = null;
  try {
    const testChild = controls.spawn(command[0], command.slice(1), { cwd: commandCwd, env: commandEnv, stdio: 'inherit' });
    if (onTestChild) onTestChild(testChild);
    exit = await waitForExit(testChild, 0, controls.clock);
  } catch {
    exit = null;
  }
  const results = [];
  for (const { service, child } of owned) results.push(await stopService({ service, child, controls }));
  if (receiptPath) writeJson(receiptPath, { ok: results.every((result) => result.state === 'clean'), services: results });
  return { code: exit?.code ?? 1, results };
}

export async function runSupervisorCli(argv, deps = {}) {
  const [runDir, controlPath, receiptPath, ackPath, specPath] = argv;
  const spec = readJson(specPath);
  const { descendants, groupMembers, probePid, probePort, readProcessIdentity } = await import('./process-control.mjs');
  const controls = { readIdentity: readProcessIdentity, groupMembers, descendants, probe: probePid, probePort, clock: { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, clearTimeout: globalThis.clearTimeout } };
  const events = deps.events ?? process;
  let failRef = null;
  const remove = () => {
    events.removeListener('uncaughtException', onUncaught);
    events.removeListener('unhandledRejection', onUncaught);
  };
  const onUncaught = (error) => {
    if (failRef) {
      const promise = failRef(error);
      if (promise?.finally) promise.finally(remove);
    }
  };
  events.on('uncaughtException', onUncaught);
  events.on('unhandledRejection', onUncaught);
  const postgresInit = spec.postgresInit ? { ...spec.postgresInit, ...(deps.postgresTools ?? {}) } : null;
  const supervisor = await startSupervisor({ runDir, controlPath, receiptPath, ackPath, postgresInit, services: spec.services, controls, ...deps, onFail: (fail) => { failRef = fail; } });
  const stop = supervisor.stop;
  supervisor.stop = async (...args) => {
    try {
      return await stop(...args);
    } finally {
      remove();
    }
  };
  return supervisor;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSupervisorCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
