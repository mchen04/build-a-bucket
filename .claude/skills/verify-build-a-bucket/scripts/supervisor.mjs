import fs from 'node:fs';
import path from 'node:path';
import { spawn as realSpawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

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
    if (timeoutMs > 0) clock.setTimeout(() => finish(null), timeoutMs);
  });
}

function alreadyExited(child) {
  if (child.exitCode !== null && child.exitCode !== undefined) return { code: child.exitCode, signal: child.signalCode ?? null };
  if (child.signalCode) return { code: null, signal: child.signalCode };
  return null;
}

export async function stopService({ service, child, controls }) {
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
  const live = pids.filter((pid) => probe(pid) !== 'absent');
  if (live.length) return { name: service.name, pid: child.pid, state: 'uncertain', reason: `descendants live: ${live.join(',')}` };
  const groupAfter = groupMembers(child.pid);
  if (!groupAfter.ok) return { name: service.name, pid: child.pid, state: 'uncertain', reason: 'group enumeration failed' };
  const groupLive = groupAfter.members.filter((member) => member.pid !== child.pid && probe(member.pid) !== 'absent');
  if (groupLive.length) return { name: service.name, pid: child.pid, state: 'uncertain', reason: `group members live: ${groupLive.map((member) => member.pid).join(',')}` };
  return { name: service.name, pid: child.pid, state: 'clean', reason: null };
}

export async function startSupervisor({
  runDir,
  services,
  controlPath,
  receiptPath,
  ackPath,
  spawn = realSpawn,
  clock = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, clearTimeout: globalThis.clearTimeout },
  controls,
  handoffMs = 180000,
  exit = process.exit,
}) {
  const children = services.map((service) => {
    const stdio = service.logPath ? ['ignore', fs.openSync(service.logPath, 'a'), fs.openSync(service.logPath, 'a')] : (service.stdio ?? 'ignore');
    return { service, child: spawn(service.command, service.args, { cwd: service.cwd, env: service.env, stdio, detached: service.detached ?? false }) };
  });
  writeJson(path.join(runDir, 'supervisor.json'), { pid: process.pid, controlPath, receiptPath, ackPath, services: children.map(({ service, child }) => ({ name: service.name, pid: child.pid })) });
  let stopping = false;
  let poll = null;
  let handoff = null;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (poll) clock.clearInterval(poll);
    if (handoff) clock.clearTimeout(handoff);
    const results = [];
    for (const { service, child } of children) results.push(await stopService({ service, child, controls }));
    writeJson(receiptPath, { ok: results.every((result) => result.state === 'clean'), services: results });
    exit(0);
    return results;
  };
  poll = clock.setInterval(() => {
    if (fs.existsSync(controlPath)) {
      clock.clearInterval(poll);
      stop();
    }
  }, 250);
  handoff = clock.setTimeout(() => {
    if (!fs.existsSync(ackPath)) stop();
  }, handoffMs);
  return { children, stop };
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [runDir, controlPath, receiptPath, ackPath, specPath] = process.argv.slice(2);
  const spec = readJson(specPath);
  const { descendants, groupMembers, probePid, probePort, readProcessIdentity } = await import('./process-control.mjs');
  const controls = { readIdentity: readProcessIdentity, groupMembers, descendants, probe: probePid, probePort, clock: { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, clearTimeout: globalThis.clearTimeout } };
  startSupervisor({ runDir, controlPath, receiptPath, ackPath, services: spec.services, controls }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
