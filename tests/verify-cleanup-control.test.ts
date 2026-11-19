import { describe, expect, it } from 'vitest';
import { probePid, probePort, sameIdentity } from '../.claude/skills/verify-build-a-bucket/scripts/process-control.mjs';

const root = { pid: 100, startTime: 'Wed Nov 19 10:00:00 2026', command: 'node dev-server.ts', pgid: 100 };

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
