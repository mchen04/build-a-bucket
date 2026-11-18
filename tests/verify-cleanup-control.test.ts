import { describe, expect, it } from 'vitest';
import { cleanupAll, cleanupOwned, cleanupRun, probePid, probePort, sameIdentity, stopOwnedPostgres } from '../.claude/skills/verify-build-a-bucket/scripts/process-control.mjs';
import type { ProcessIdentity, ProbeState } from '../.claude/skills/verify-build-a-bucket/scripts/process-control.mjs';

const root = { pid: 100, startTime: 'Wed Nov 19 10:00:00 2026', command: 'node dev-server.ts', pgid: 100 };
const child = { pid: 101, startTime: 'Wed Nov 19 10:00:01 2026', command: 'node worker', pgid: 100 };
const postmaster = { pid: 200, startTime: 'Wed Nov 19 10:00:02 2026', command: 'postgres -D /tmp/run/pg', pgid: 200 };
type GroupResult = { ok: true; members: ProcessIdentity[] } | { ok: false; reason: string };

function harness({
  identities = new Map<number, ProcessIdentity>(),
  probes = new Map<number, ProbeState>(),
  group = { ok: true, members: [] as ProcessIdentity[] } as GroupResult,
  portState = 'absent' as ProbeState,
} = {}) {
  const signals: [number, string][] = [];
  const log: string[] = [];
  const removed: string[] = [];
  return {
    signals,
    log,
    removed,
    controls: {
      readIdentity: (pid: number) => identities.get(pid) ?? null,
      signal: (pid: number, signal: string) => {
        signals.push([pid, signal]);
        log.push(`${pid}:${signal}`);
      },
      sleep: async () => {
        log.push('sleep');
      },
      probe: (pid: number) => probes.get(pid) ?? 'absent',
      groupMembers: () => group,
      probePort: () => portState,
      removeDir: (dir: string) => removed.push(dir),
    },
  };
}

describe('process probes', () => {
  it('distinguishes present, absent and unknown pids', () => {
    expect(probePid(1, { kill: () => {} })).toBe('present');
    expect(probePid(1, { kill: () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); } })).toBe('absent');
    expect(probePid(1, { kill: () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } })).toBe('unknown');
    expect(probePid(1, { kill: () => { throw Object.assign(new Error('failed'), { code: 'EINVAL' }); } })).toBe('unknown');
  });

  it('distinguishes present, absent and unknown ports', () => {
    expect(probePort(1, { lsof: () => '123\n' })).toBe('present');
    expect(probePort(1, { lsof: () => { throw Object.assign(new Error('none'), { status: 1, stdout: '', stderr: '' }); } })).toBe('absent');
    expect(probePort(1, { lsof: () => { throw Object.assign(new Error('denied'), { status: 1, stdout: '', stderr: 'Permission denied' }); } })).toBe('unknown');
    expect(probePort(1, { lsof: () => { throw Object.assign(new Error('failed'), { status: 2 }); } })).toBe('unknown');
  });

  it('compares identities by pid, start time, command and process group', () => {
    expect(sameIdentity(root, { ...root })).toBe(true);
    expect(sameIdentity(root, { ...root, startTime: 'different' })).toBe(false);
    expect(sameIdentity(root, { ...root, pgid: 999 })).toBe(false);
  });
});

describe('owned cleanup', () => {
  it('stops an owned process', async () => {
    const { signals, controls } = harness({ identities: new Map([[100, root]]), probes: new Map([[100, 'absent']]) });
    const result = await cleanupOwned({ root, controls });
    expect(signals).toEqual([[100, 'SIGTERM'], [100, 'SIGKILL']]);
    expect(result.stopped).toEqual([100]);
    expect(result.uncertain).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('passes a resource that is genuinely missing', async () => {
    const { signals, controls } = harness({ probes: new Map([[100, 'absent']]) });
    const result = await cleanupOwned({ root, controls });
    expect(signals).toEqual([]);
    expect(result.uncertain).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('sends no signal to a reused root pid', async () => {
    const { signals, controls } = harness({ identities: new Map([[100, { ...root, startTime: 'different' }]]), probes: new Map([[100, 'present']]) });
    const result = await cleanupOwned({ root, controls });
    expect(signals).toEqual([]);
    expect(result.uncertain).toEqual([{ pid: 100, reason: 'root identity changed before cleanup' }]);
    expect(result.failures).toEqual([]);
  });

  it('sends no signal to an unrelated group member', async () => {
    const { signals, controls } = harness({ identities: new Map([[100, root], [101, { ...child, pgid: 999 }]]), probes: new Map([[100, 'absent'], [101, 'present']]) });
    const result = await cleanupOwned({ root, members: [{ identity: { ...child, pgid: 999 }, owned: true }], controls });
    expect(signals).toEqual([[100, 'SIGTERM'], [100, 'SIGKILL']]);
    expect(signals.some(([pid]) => pid === 101)).toBe(false);
    expect(result.uncertain.some((entry) => entry.pid === 101)).toBe(true);
    expect(result.failures).toEqual([{ pid: 101, reason: 'still live' }]);
  });

  it('sends no signal to a member born before the root', async () => {
    const earlier = { ...child, startTime: 'Wed Nov 19 09:59:59 2026' };
    const { signals, controls } = harness({ identities: new Map([[100, root], [101, earlier]]), probes: new Map([[100, 'absent'], [101, 'present']]) });
    const result = await cleanupOwned({ root, members: [{ identity: earlier, owned: false }], controls });
    expect(signals).toEqual([[100, 'SIGTERM'], [100, 'SIGKILL']]);
    expect(signals.some(([pid]) => pid === 101)).toBe(false);
    expect(result.uncertain).toEqual([{ pid: 101, reason: 'member started before the root' }]);
    expect(result.failures).toEqual([{ pid: 101, reason: 'still live' }]);
  });

  it('sends no signal to a member whose identity is unreadable', async () => {
    const { signals, controls } = harness({ identities: new Map([[100, root]]), probes: new Map([[100, 'absent'], [101, 'present']]) });
    const result = await cleanupOwned({ root, members: [{ identity: child, owned: true }], controls });
    expect(signals).toEqual([[100, 'SIGTERM'], [100, 'SIGKILL']]);
    expect(signals.some(([pid]) => pid === 101)).toBe(false);
    expect(result.uncertain).toEqual([{ pid: 101, reason: 'member identity unavailable' }]);
    expect(result.failures).toEqual([{ pid: 101, reason: 'still live' }]);
  });

  it('sends no SIGKILL when the pid is reused between TERM and KILL', async () => {
    const signals: [number, string][] = [];
    let calls = 0;
    const controls = {
      readIdentity: (pid: number) => {
        if (pid !== 100) return null;
        calls += 1;
        return calls <= 2 ? root : { ...root, startTime: 'different' };
      },
      signal: (pid: number, signal: string) => signals.push([pid, signal]),
      sleep: async () => {},
      probe: () => 'present' as const,
    };
    const result = await cleanupOwned({ root, controls });
    expect(signals).toEqual([[100, 'SIGTERM']]);
    expect(result.uncertain.some((entry) => entry.reason.includes('before SIGKILL'))).toBe(true);
    expect(result.failures).toEqual([{ pid: 100, reason: 'still live' }]);
  });

  it('fails an unknown process state', async () => {
    const { controls } = harness({ identities: new Map([[100, root]]), probes: new Map([[100, 'unknown']]) });
    const result = await cleanupOwned({ root, controls });
    expect(result.failures).toEqual([{ pid: 100, reason: 'process state unknown' }]);
  });

  it('fails an owned process that stays live', async () => {
    const { controls } = harness({ identities: new Map([[100, root]]), probes: new Map([[100, 'present']]) });
    const result = await cleanupOwned({ root, controls });
    expect(result.failures).toEqual([{ pid: 100, reason: 'still live' }]);
  });
});

describe('cleanup wiring', () => {
  it('runs the actual wiring and waits before escalation', async () => {
    const { signals, log, controls } = harness({
      identities: new Map([[100, root], [101, child]]),
      probes: new Map([[100, 'absent'], [101, 'absent']]),
      group: { ok: true, members: [root, child] },
    });
    const result = await cleanupRun({ state: { pid: 100, port: 4391, identity: root }, controls });
    expect(signals).toEqual([[101, 'SIGTERM'], [100, 'SIGTERM'], [101, 'SIGKILL'], [100, 'SIGKILL']]);
    expect(log).toEqual(['101:SIGTERM', '100:SIGTERM', 'sleep', '101:SIGKILL', '100:SIGKILL']);
    expect(result.portState).toBe('absent');
    expect(result.uncertain).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('sends no signal when group enumeration fails', async () => {
    const { signals, controls } = harness({ identities: new Map([[100, root]]), group: { ok: false, reason: 'ps failed' } });
    const result = await cleanupRun({ state: { pid: 100, port: 4391, identity: root }, controls });
    expect(signals).toEqual([]);
    expect(result.uncertain).toEqual([{ pid: 100, reason: 'group enumeration failed: ps failed' }]);
  });

  it('sends no signal when the root identity is reused, even with children', async () => {
    const { signals, controls } = harness({
      identities: new Map([[100, { ...root, startTime: 'different' }], [101, child]]),
      probes: new Map([[100, 'present'], [101, 'present']]),
      group: { ok: true, members: [root, child] },
    });
    const result = await cleanupRun({ state: { pid: 100, port: 4391, identity: root }, controls });
    expect(signals).toEqual([]);
    expect(result.uncertain).toEqual([{ pid: 100, reason: 'root identity changed before cleanup' }]);
  });

  it('reports uncertainty when no launch identity was recorded', async () => {
    const { signals, controls } = harness();
    const result = await cleanupRun({ state: { pid: 100, port: 4391, identity: null }, controls });
    expect(signals).toEqual([]);
    expect(result.uncertain).toEqual([{ pid: 100, reason: 'no launch identity recorded' }]);
  });
});

describe('owned Postgres cleanup', () => {
  const handle = { dataDir: '/tmp/run/pg', pgPort: 55434, postmasterIdentity: postmaster };

  it('stops a verified postmaster and requires absence', async () => {
    let calls = 0;
    const { signals, controls } = harness({ probes: new Map([[200, 'absent']]) });
    controls.readIdentity = (_pid: number) => {
      calls += 1;
      return calls === 1 ? postmaster : null;
    };
    const result = await stopOwnedPostgres({ handle, controls });
    expect(signals).toEqual([[200, 'SIGTERM']]);
    expect(result.state).toBe('clean');
    expect(result.removed).toBe(false);
  });

  it('sends no signal to a reused postmaster pid', async () => {
    const { signals, controls } = harness({ identities: new Map([[200, { ...postmaster, startTime: 'different' }]]), probes: new Map([[200, 'present']]) });
    const result = await stopOwnedPostgres({ handle, controls });
    expect(signals).toEqual([]);
    expect(result.state).toBe('uncertain');
  });

  it('sends no signal when the postmaster command does not contain the data dir', async () => {
    const { signals, controls } = harness({ identities: new Map([[200, { ...postmaster, command: 'postgres -D /tmp/other' }]]), probes: new Map([[200, 'present']]) });
    const result = await stopOwnedPostgres({ handle, controls });
    expect(signals).toEqual([]);
    expect(result.state).toBe('uncertain');
  });

  it('passes a postmaster that is genuinely missing', async () => {
    const { signals, controls } = harness({ probes: new Map([[200, 'absent']]) });
    const result = await stopOwnedPostgres({ handle, controls });
    expect(signals).toEqual([]);
    expect(result.state).toBe('clean');
  });

  it('fails a postmaster that stays live', async () => {
    const { controls } = harness({ identities: new Map([[200, postmaster]]), probes: new Map([[200, 'present']]) });
    const result = await stopOwnedPostgres({ handle, controls });
    expect(result.state).toBe('uncertain');
  });

  it('keeps the data dir when Postgres cleanup is uncertain', async () => {
    const { removed, controls } = harness({ identities: new Map([[200, { ...postmaster, startTime: 'different' }]]), probes: new Map([[200, 'present']]) });
    const result = await cleanupAll({ state: { pid: 100, port: 4391, identity: root, localDb: { ...handle, remove: true } }, controls });
    expect(result.postgres.state).toBe('uncertain');
    expect(result.postgres.removed).toBe(false);
    expect(removed).toEqual([]);
  });
});
