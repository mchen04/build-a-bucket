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

export function groupMembers(pgid) {
  try {
    const out = execFileSync('ps', ['-A', '-o', 'pid=,pgid=,lstart=,command='], { encoding: 'utf8' });
    const members = out.split('\n').map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.*)$/.exec(line);
      if (!match) return null;
      return { pid: Number(match[1]), pgid: Number(match[2]), startTime: match[3].trim(), command: match[4].trim() };
    }).filter((entry) => entry && entry.pgid === pgid);
    return { ok: true, members };
  } catch (error) {
    return { ok: false, reason: error?.message ?? 'ps failed' };
  }
}

export function descendants(pid) {
  try {
    const out = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).trim();
    const kids = out ? out.split('\n').filter(Boolean).map(Number) : [];
    return { ok: true, pids: kids.flatMap((kid) => [kid, ...descendants(kid).pids]) };
  } catch (error) {
    if (error?.status === 1) return { ok: true, pids: [] };
    return { ok: false, reason: error?.message ?? 'pgrep failed' };
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, value] = process.argv.slice(2);
  if (command === 'probe-pid') console.log(probePid(Number(value)));
  else if (command === 'probe-port') console.log(probePort(Number(value)));
  else {
    console.error('usage: process-control.mjs probe-pid|probe-port <value>');
    process.exit(2);
  }
}
