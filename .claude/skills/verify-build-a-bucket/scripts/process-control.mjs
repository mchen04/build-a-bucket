import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function sameIdentity(a, b) {
  return Boolean(a && b && a.pid === b.pid && a.startTime === b.startTime && a.command === b.command && a.pgid === b.pgid);
}

export function readProcessIdentity(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-o', 'pgid=', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    const match = /^(.{24})\s+(\d+)\s+(.*)$/.exec(out);
    if (!match) return null;
    return { pid, startTime: match[1].trim(), pgid: Number(match[2]), command: match[3].trim() };
  } catch {
    return null;
  }
}

export function probePid(pid, controls = {}) {
  const kill = controls.kill ?? process.kill;
  try {
    kill(pid, 0);
    return 'present';
  } catch (error) {
    return error?.code === 'ESRCH' ? 'absent' : 'unknown';
  }
}

export function probePort(port, controls = {}) {
  const lsof = controls.lsof ?? ((value) => execFileSync('lsof', ['-nP', `-iTCP:${value}`, '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  try {
    return lsof(port).trim() ? 'present' : 'absent';
  } catch (error) {
    if (error?.status === 1 && !String(error.stdout ?? '').trim() && !String(error.stderr ?? '').trim()) return 'absent';
    return 'unknown';
  }
}

function startedAtOrAfter(identity, root) {
  const a = Date.parse(identity.startTime);
  const b = Date.parse(root.startTime);
  return Number.isFinite(a) && Number.isFinite(b) && a >= b;
}

export async function cleanupOwned({ root, members = [], controls }) {
  const { readIdentity, signal, sleep, probe } = controls;
  const stopped = [];
  const uncertain = [];
  const failures = [];
  const rootCurrent = readIdentity(root.pid);
  if (!rootCurrent) {
    if (probe(root.pid) !== 'absent') uncertain.push({ pid: root.pid, reason: 'root identity unavailable' });
    return { stopped, uncertain, failures };
  }
  if (!sameIdentity(root, rootCurrent)) {
    uncertain.push({ pid: root.pid, reason: 'root identity changed before cleanup' });
    return { stopped, uncertain, failures };
  }
  for (const member of [...members].reverse()) {
    const expected = member.identity;
    if (!member.owned) {
      uncertain.push({ pid: expected.pid, reason: 'member started before the root' });
      continue;
    }
    const current = readIdentity(expected.pid);
    if (!current) {
      uncertain.push({ pid: expected.pid, reason: 'member identity unavailable' });
      continue;
    }
    if (!sameIdentity(expected, current)) {
      uncertain.push({ pid: expected.pid, reason: 'member identity changed before SIGTERM' });
      continue;
    }
    if (current.pgid !== root.pgid) {
      uncertain.push({ pid: expected.pid, reason: 'member left the run process group' });
      continue;
    }
    try {
      signal(expected.pid, 'SIGTERM');
      stopped.push(expected.pid);
    } catch (error) {
      uncertain.push({ pid: expected.pid, reason: `SIGTERM failed: ${error?.code ?? error?.message}` });
    }
  }
  const rootAgain = readIdentity(root.pid);
  if (!rootAgain) {
    if (probe(root.pid) !== 'absent') uncertain.push({ pid: root.pid, reason: 'root identity unavailable before SIGTERM' });
  } else if (!sameIdentity(root, rootAgain)) {
    uncertain.push({ pid: root.pid, reason: 'root identity changed before SIGTERM' });
  } else {
    try {
      signal(root.pid, 'SIGTERM');
      stopped.push(root.pid);
    } catch (error) {
      uncertain.push({ pid: root.pid, reason: `SIGTERM failed: ${error?.code ?? error?.message}` });
    }
  }
  await sleep(1500);
  for (const pid of stopped) {
    const expected = pid === root.pid ? root : members.find((entry) => entry.identity.pid === pid)?.identity;
    const current = readIdentity(pid);
    if (!current) {
      if (probe(pid) === 'absent') continue;
      uncertain.push({ pid, reason: 'identity unavailable before SIGKILL' });
      continue;
    }
    if (!sameIdentity(expected, current)) {
      uncertain.push({ pid, reason: 'identity changed before SIGKILL' });
      continue;
    }
    if (pid !== root.pid && current.pgid !== root.pgid) {
      uncertain.push({ pid, reason: 'member left the run process group before SIGKILL' });
      continue;
    }
    try {
      signal(pid, 'SIGKILL');
    } catch (error) {
      uncertain.push({ pid, reason: `SIGKILL failed: ${error?.code ?? error?.message}` });
    }
  }
  for (const expected of [root, ...members.map((entry) => entry.identity)]) {
    const state = probe(expected.pid);
    if (state === 'present') failures.push({ pid: expected.pid, reason: 'still live' });
    else if (state === 'unknown') failures.push({ pid: expected.pid, reason: 'process state unknown' });
  }
  return { stopped, uncertain, failures };
}

export async function cleanupRun({ state, controls }) {
  const root = state.identity ?? null;
  if (!root) {
    return { stopped: [], uncertain: [{ pid: state.pid, reason: 'no launch identity recorded' }], failures: [], portState: controls.probePort(state.port) };
  }
  const rootCurrent = controls.readIdentity(root.pid);
  if (!rootCurrent) {
    const rootState = controls.probe(root.pid);
    if (rootState !== 'absent') {
      return { stopped: [], uncertain: [{ pid: root.pid, reason: 'root identity unavailable' }], failures: [], portState: controls.probePort(state.port) };
    }
    const group = controls.groupMembers(root.pgid);
    if (!group.ok) {
      return { stopped: [], uncertain: [{ pid: root.pid, reason: `group enumeration failed: ${group.reason}` }], failures: [], portState: controls.probePort(state.port) };
    }
    const uncertain = [];
    const failures = [];
    for (const member of group.members.filter((identity) => identity.pid !== root.pid)) {
      const memberState = controls.probe(member.pid);
      if (memberState === 'present') {
        uncertain.push({ pid: member.pid, reason: 'member still live after the root exited' });
        failures.push({ pid: member.pid, reason: 'still live' });
      } else if (memberState === 'unknown') {
        uncertain.push({ pid: member.pid, reason: 'member state unknown' });
        failures.push({ pid: member.pid, reason: 'process state unknown' });
      }
    }
    const portState = controls.probePort(state.port);
    if (portState !== 'absent') uncertain.push({ pid: root.pid, reason: `port ${portState}` });
    return { stopped: [], uncertain, failures, portState };
  }
  if (!sameIdentity(root, rootCurrent)) {
    return { stopped: [], uncertain: [{ pid: root.pid, reason: 'root identity changed before cleanup' }], failures: [], portState: controls.probePort(state.port) };
  }
  const group = controls.groupMembers(root.pgid);
  if (!group.ok) {
    return { stopped: [], uncertain: [{ pid: root.pid, reason: `group enumeration failed: ${group.reason}` }], failures: [], portState: controls.probePort(state.port) };
  }
  const members = group.members.filter((identity) => identity.pid !== root.pid).map((identity) => ({ identity, owned: startedAtOrAfter(identity, root) }));
  const result = await cleanupOwned({ root, members, controls });
  return { ...result, portState: controls.probePort(state.port) };
}

export async function stopOwnedPostgres({ handle, controls }) {
  const { readIdentity, signal, sleep, probe, probePort, groupMembers } = controls;
  const identity = handle.postmasterIdentity ?? null;
  const dataDir = handle.dataDir;
  const postStopProof = () => {
    const group = groupMembers(identity.pgid);
    if (!group.ok) return { state: 'uncertain', reason: `postmaster group enumeration failed: ${group.reason}` };
    const leftover = group.members.filter((member) => member.pid !== identity.pid && probe(member.pid) !== 'absent');
    if (leftover.length) return { state: 'uncertain', reason: `postmaster group still has ${leftover.length} live member(s)` };
    const portState = probePort(handle.pgPort);
    if (portState !== 'absent') return { state: 'uncertain', reason: `postgres port ${portState}` };
    return { state: 'clean', reason: null };
  };
  if (!identity) return { state: 'uncertain', reason: 'no postmaster identity recorded', dataDir, removed: false };
  const current = readIdentity(identity.pid);
  if (!current) {
    const pidState = probe(identity.pid);
    if (pidState !== 'absent') return { state: 'uncertain', reason: `postmaster ${pidState}`, dataDir, removed: false };
    return { ...postStopProof(), dataDir, removed: false };
  }
  if (!sameIdentity(identity, current) || !current.command.includes(dataDir)) {
    return { state: 'uncertain', reason: 'postmaster identity changed', dataDir, removed: false };
  }
  try {
    signal(identity.pid, 'SIGINT');
  } catch (error) {
    return { state: 'uncertain', reason: `SIGINT failed: ${error?.code ?? error?.message}`, dataDir, removed: false };
  }
  let stopped = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(1000);
    if (probe(identity.pid) === 'absent') {
      stopped = true;
      break;
    }
  }
  if (!stopped) return { state: 'uncertain', reason: 'postmaster still live at the deadline', dataDir, removed: false };
  return { ...postStopProof(), dataDir, removed: false };
}

export async function cleanupAll({ state, controls }) {
  const app = await cleanupRun({ state, controls });
  const postgres = state.localDb ? await stopOwnedPostgres({ handle: state.localDb, controls }) : { state: 'clean', reason: null, dataDir: null, removed: false };
  if (postgres.state === 'clean' && state.localDb?.remove && postgres.dataDir) {
    controls.removeDir(postgres.dataDir);
    postgres.removed = true;
  }
  return { ...app, postgres };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, value] = process.argv.slice(2);
  if (command === 'probe-pid') console.log(probePid(Number(value)));
  else if (command === 'probe-port') console.log(probePort(Number(value)));
  else {
    console.error('usage: process-control.mjs probe-pid|probe-port <value>');
    process.exit(2);
  }
}
