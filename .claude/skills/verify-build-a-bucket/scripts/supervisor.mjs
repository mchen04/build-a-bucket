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

export async function stopService({ service, child, controls }) {
  const { readIdentity, groupMembers, probe, probePort, clock } = controls;
  const snapshot = groupMembers(child.pid);
  const identities = snapshot.ok ? snapshot.members.filter((member) => member.pid !== child.pid).map((member) => readIdentity(member.pid)).filter(Boolean) : [];
  if (service.kind === 'postgres') {
    child.kill('SIGINT');
    const exit = await waitForExit(child, 30000, clock);
    if (!exit) return { name: service.name, pid: child.pid, state: 'uncertain', reason: 'postmaster did not exit within 30s' };
    if (exit.code !== 0) return { name: service.name, pid: child.pid, state: 'uncertain', reason: `postmaster exit ${exit.code ?? exit.signal}` };
    const portState = probePort(service.port);
    if (portState !== 'absent') return { name: service.name, pid: child.pid, state: 'uncertain', reason: `postgres port ${portState}` };
    return { name: service.name, pid: child.pid, state: 'clean', reason: null };
  }
  child.kill('SIGTERM');
  let exit = await waitForExit(child, 10000, clock);
  if (!exit) {
    child.kill('SIGKILL');
    exit = await waitForExit(child, 5000, clock);
  }
  if (!exit) return { name: service.name, pid: child.pid, state: 'uncertain', reason: 'app did not exit' };
  const live = identities.filter((identity) => probe(identity.pid) !== 'absent');
  if (live.length) return { name: service.name, pid: child.pid, state: 'uncertain', reason: `descendants live: ${live.map((identity) => identity.pid).join(',')}` };
  const group = groupMembers(child.pid);
  if (!group.ok) return { name: service.name, pid: child.pid, state: 'uncertain', reason: 'group enumeration failed' };
  const groupLive = group.members.filter((member) => member.pid !== child.pid && probe(member.pid) !== 'absent');
  if (groupLive.length) return { name: service.name, pid: child.pid, state: 'uncertain', reason: `group members live: ${groupLive.map((member) => member.pid).join(',')}` };
  return { name: service.name, pid: child.pid, state: 'clean', reason: null };
}

export async function startSupervisor({ runDir, services, controlPath, receiptPath, spawn = realSpawn, clock = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval }, controls, handoffMs = 120000 }) {
  const children = services.map((service) => ({ service, child: spawn(service.command, service.args, { cwd: service.cwd, env: service.env, stdio: service.stdio ?? 'ignore' }) }));
  writeJson(path.join(runDir, 'supervisor.json'), { pid: process.pid, controlPath, receiptPath, services: children.map(({ service, child }) => ({ name: service.name, pid: child.pid })) });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const results = [];
    for (const { service, child } of children) results.push(await stopService({ service, child, controls }));
    writeJson(receiptPath, { ok: results.every((result) => result.state === 'clean'), services: results });
    return results;
  };
  const poll = clock.setInterval(() => {
    if (fs.existsSync(controlPath)) {
      clock.clearInterval(poll);
      stop();
    }
  }, 250);
  clock.setTimeout(() => {
    if (!fs.existsSync(controlPath)) stop();
  }, handoffMs);
  return { children, stop };
}

export async function requestStop({ controlPath, receiptPath, timeoutMs = 60000, clock = { setTimeout } }) {
  writeJson(controlPath, { command: 'stop' });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = readJson(receiptPath);
    if (receipt) return receipt;
    await new Promise((resolve) => clock.setTimeout(resolve, 250));
  }
  return { ok: false, services: [], reason: 'supervisor receipt timeout' };
}

export async function runSupervised({ services = [], children = null, command, commandEnv, commandCwd, controls, receiptPath }) {
  const owned = children ?? services.map((service) => ({ service, child: controls.spawn(service.command, service.args, { cwd: service.cwd, env: service.env, stdio: service.stdio ?? 'inherit' }) }));
  let exit = null;
  try {
    const testChild = controls.spawn(command[0], command.slice(1), { cwd: commandCwd, env: commandEnv, stdio: 'inherit' });
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
  const [runDir, controlPath, receiptPath, specPath] = process.argv.slice(2);
  const spec = readJson(specPath);
  const { groupMembers, probePid, probePort, readProcessIdentity } = await import('./process-control.mjs');
  const controls = { readIdentity: readProcessIdentity, groupMembers, probe: probePid, probePort, clock: { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval } };
  startSupervisor({ runDir, controlPath, receiptPath, services: spec.services, controls }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
