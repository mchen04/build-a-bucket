import { describe, expect, it } from 'vitest';
import { cleanupOwned, probePid, probePort, sameIdentity } from '../.claude/skills/verify-build-a-bucket/scripts/process-control.mjs';

const root = { pid: 100, startTime: 'Wed Nov 19 10:00:00 2026', command: 'node dev-server.ts', pgid: 100 };
const child = { pid: 101, startTime: 'Wed Nov 19 10:00:01 2026', command: 'node worker', pgid: 100 };

function harness({ identities = new Map(), probes = new Map() } = {}) {
  const signals: [number, string][] = [];
  return {
    signals,
    controls: {
      readIdentity: (pid: number) => identities.get(pid) ?? null,
      signal: (pid: number, signal: string) => signals.push([pid, signal]),
      sleep: () => {},
      probe: (pid: number) => probes.get(pid) ?? 'absent',
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
    expect(probePort(1, { lsof: () => { throw Object.assign(new Error('none'), { status: 1 }); } })).toBe('absent');
    expect(probePort(1, { lsof: () => { throw Object.assign(new Error('failed'), { status: 2 }); } })).toBe('unknown');
  });

  it('compares identities by pid, start time, command and process group', () => {
    expect(sameIdentity(root, { ...root })).toBe(true);
    expect(sameIdentity(root, { ...root, startTime: 'different' })).toBe(false);
    expect(sameIdentity(root, { ...root, pgid: 999 })).toBe(false);
  });
});

describe('owned cleanup', () => {
  it('stops an owned process', () => {
    const { signals, controls } = harness({ identities: new Map([[100, root]]), probes: new Map([[100, 'absent']]) });
    const result = cleanupOwned({ root, controls });
    expect(signals).toEqual([[100, 'SIGTERM'], [100, 'SIGKILL']]);
    expect(result.stopped).toEqual([100]);
    expect(result.uncertain).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('passes a resource that is genuinely missing', () => {
    const { signals, controls } = harness({ probes: new Map([[100, 'absent']]) });
    const result = cleanupOwned({ root, controls });
    expect(signals).toEqual([]);
    expect(result.uncertain).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('sends no signal to a reused root pid', () => {
    const { signals, controls } = harness({ identities: new Map([[100, { ...root, startTime: 'different' }]]), probes: new Map([[100, 'present']]) });
    const result = cleanupOwned({ root, controls });
    expect(signals).toEqual([]);
    expect(result.uncertain).toHaveLength(1);
    expect(result.failures).toEqual([{ pid: 100, reason: 'still live' }]);
  });

  it('sends no signal to an unrelated descendant', () => {
    const { signals, controls } = harness({ identities: new Map([[100, root], [101, { ...child, pgid: 999 }]]), probes: new Map([[100, 'absent'], [101, 'present']]) });
    const result = cleanupOwned({ root, descendants: [child], controls });
    expect(signals).toEqual([[100, 'SIGTERM'], [100, 'SIGKILL']]);
    expect(signals.some(([pid]) => pid === 101)).toBe(false);
    expect(result.uncertain.some((entry) => entry.pid === 101)).toBe(true);
    expect(result.failures).toEqual([{ pid: 101, reason: 'still live' }]);
  });

  it('sends no SIGKILL when the pid is reused between TERM and KILL', () => {
    const signals: [number, string][] = [];
    let calls = 0;
    const controls = {
      readIdentity: (pid: number) => {
        if (pid !== 100) return null;
        calls += 1;
        return calls === 1 ? root : { ...root, startTime: 'different' };
      },
      signal: (pid: number, signal: string) => signals.push([pid, signal]),
      sleep: () => {},
      probe: () => 'present' as const,
    };
    const result = cleanupOwned({ root, controls });
    expect(signals).toEqual([[100, 'SIGTERM']]);
    expect(result.uncertain.some((entry) => entry.reason.includes('before SIGKILL'))).toBe(true);
    expect(result.failures).toEqual([{ pid: 100, reason: 'still live' }]);
  });

  it('fails an unknown process state', () => {
    const { controls } = harness({ identities: new Map([[100, root]]), probes: new Map([[100, 'unknown']]) });
    const result = cleanupOwned({ root, controls });
    expect(result.failures).toEqual([{ pid: 100, reason: 'process state unknown' }]);
  });

  it('fails an owned process that stays live', () => {
    const { controls } = harness({ identities: new Map([[100, root]]), probes: new Map([[100, 'present']]) });
    const result = cleanupOwned({ root, controls });
    expect(result.failures).toEqual([{ pid: 100, reason: 'still live' }]);
  });
});
