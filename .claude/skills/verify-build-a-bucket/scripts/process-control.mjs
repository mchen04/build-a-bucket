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
  const lsof = controls.lsof ?? ((value) => execFileSync('lsof', ['-nP', `-iTCP:${value}`, '-sTCP:LISTEN'], { encoding: 'utf8' }));
  try {
    return lsof(port).trim() ? 'present' : 'absent';
  } catch (error) {
    return error?.status === 1 ? 'absent' : 'unknown';
  }
}

export function cleanupOwned({ root, descendants = [], controls }) {
  const { readIdentity, signal, sleep, probe } = controls;
  const stopped = [];
  const uncertain = [];
  const failures = [];
  for (const expected of [...descendants].reverse().concat(root)) {
    const current = readIdentity(expected.pid);
    if (!current) {
      if (probe(expected.pid) === 'absent') continue;
      uncertain.push({ pid: expected.pid, reason: 'identity unavailable' });
      continue;
    }
    if (!sameIdentity(expected, current)) {
      uncertain.push({ pid: expected.pid, reason: 'identity changed before SIGTERM' });
      continue;
    }
    if (expected.pid !== root.pid && current.pgid !== root.pgid) {
      uncertain.push({ pid: expected.pid, reason: 'descendant left the run process group' });
      continue;
    }
    try {
      signal(expected.pid, 'SIGTERM');
      stopped.push(expected.pid);
    } catch (error) {
      uncertain.push({ pid: expected.pid, reason: `SIGTERM failed: ${error?.code ?? error?.message}` });
    }
  }
  sleep(1500);
  for (const pid of stopped) {
    const expected = pid === root.pid ? root : descendants.find((entry) => entry.pid === pid);
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
      uncertain.push({ pid, reason: 'descendant left the run process group before SIGKILL' });
      continue;
    }
    try {
      signal(pid, 'SIGKILL');
    } catch (error) {
      uncertain.push({ pid, reason: `SIGKILL failed: ${error?.code ?? error?.message}` });
    }
  }
  for (const expected of [...descendants, root]) {
    const state = probe(expected.pid);
    if (state === 'present') failures.push({ pid: expected.pid, reason: 'still live' });
    else if (state === 'unknown') failures.push({ pid: expected.pid, reason: 'process state unknown' });
  }
  return { stopped, uncertain, failures };
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
