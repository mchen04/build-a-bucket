import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { requestStop, runSupervised, startSupervisor, stopService } from '../.claude/skills/verify-build-a-bucket/scripts/supervisor.mjs';
import type { Controls } from '../.claude/skills/verify-build-a-bucket/scripts/supervisor.mjs';

class FakeChild {
  pid: number;
  signals: string[] = [];
  exited = false;
  exitCode: number | null = null;
  exitSignal: string | null = null;
  private exitOn: Set<string>;
  private listeners: ((code: number | null, signal: string | null) => void)[] = [];

  constructor(pid: number, { exitOn = new Set(['SIGTERM', 'SIGINT', 'SIGKILL']) } = {}) {
    this.pid = pid;
    this.exitOn = exitOn;
  }

  once(event: string, listener: (code: number | null, signal: string | null) => void) {
    if (event === 'exit') {
      if (this.exited) listener(this.exitCode, this.exitSignal);
      else this.listeners.push(listener);
    }
    return this;
  }

  kill(signal: string) {
    this.signals.push(signal);
    if (this.exitOn.has(signal)) this.exit(signal === 'SIGKILL' ? null : 0, signal === 'SIGKILL' ? 'SIGKILL' : null);
    return true;
  }

  exit(code: number | null, signal: string | null = null) {
    this.exited = true;
    this.exitCode = code;
    this.exitSignal = signal;
    for (const listener of this.listeners.splice(0)) listener(code, signal);
  }
}

function clock({ timeout = false } = {}) {
  return {
    setTimeout: (fn: () => void) => {
      if (timeout) fn();
      return 0;
    },
    setInterval: () => 0,
    clearInterval: () => {},
  };
}

function controls({ identities = new Map(), probes = new Map(), groups = new Map(), portState = 'absent' as 'present' | 'absent' | 'unknown', clock: c = clock() } = {}): Controls {
  return {
    readIdentity: (pid: number) => identities.get(pid) ?? null,
    groupMembers: (pgid: number) => groups.get(pgid) ?? { ok: true, members: [] },
    probe: (pid: number) => probes.get(pid) ?? 'absent',
    probePort: () => portState,
    clock: c,
  };
}

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'r26-'));
  temps.push(dir);
  return dir;
}

describe('supervised service stop', () => {
  it('stops an app child cleanly', async () => {
    const child = new FakeChild(100);
    const result = await stopService({ service: { name: 'app', kind: 'app' }, child, controls: controls() });
    expect(child.signals).toEqual(['SIGTERM']);
    expect(result.state).toBe('clean');
  });

  it('fails a surviving app worker with its pid named', async () => {
    const child = new FakeChild(100);
    const worker = { pid: 101, startTime: 'x', command: 'worker', pgid: 100 };
    const result = await stopService({
      service: { name: 'app', kind: 'app' },
      child,
      controls: controls({ groups: new Map([[100, { ok: true, members: [worker] }]]), probes: new Map([[101, 'present']]) }),
    });
    expect(result.state).toBe('uncertain');
    expect(result.reason).toContain('101');
  });

  it('finds a worker that appears during the grace wait', async () => {
    const child = new FakeChild(100, { exitOn: new Set(['SIGKILL']) });
    const worker = { pid: 101, startTime: 'x', command: 'worker', pgid: 100 };
    let calls = 0;
    const result = await stopService({
      service: { name: 'app', kind: 'app' },
      child,
      controls: {
        readIdentity: () => null,
        groupMembers: () => {
          calls += 1;
          return calls === 1 ? { ok: true, members: [] } : { ok: true, members: [worker] };
        },
        probe: () => 'present',
        probePort: () => 'absent',
        clock: clock({ timeout: true }),
      },
    });
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(result.state).toBe('uncertain');
    expect(result.reason).toContain('101');
  });

  it('fails a group enumeration error', async () => {
    const child = new FakeChild(100);
    const result = await stopService({
      service: { name: 'app', kind: 'app' },
      child,
      controls: controls({ groups: new Map([[100, { ok: false, reason: 'ps failed' }]]) }),
    });
    expect(result.state).toBe('uncertain');
    expect(result.reason).toContain('group enumeration failed');
  });

  it('fails an unknown worker inspection', async () => {
    const child = new FakeChild(100);
    const worker = { pid: 101, startTime: 'x', command: 'worker', pgid: 100 };
    const result = await stopService({
      service: { name: 'app', kind: 'app' },
      child,
      controls: controls({ groups: new Map([[100, { ok: true, members: [worker] }]]), probes: new Map([[101, 'unknown']]) }),
    });
    expect(result.state).toBe('uncertain');
    expect(result.reason).toContain('101');
  });

  it('stops Postgres with SIGINT and requires exit 0 and an absent port', async () => {
    const child = new FakeChild(200);
    const result = await stopService({ service: { name: 'postgres', kind: 'postgres', port: 55434 }, child, controls: controls() });
    expect(child.signals).toEqual(['SIGINT']);
    expect(result.state).toBe('clean');
  });

  it('fails a Postgres crash exit', async () => {
    const child = new FakeChild(200);
    child.kill = (signal: string) => {
      child.signals.push(signal);
      child.exit(1);
      return true;
    };
    const result = await stopService({ service: { name: 'postgres', kind: 'postgres', port: 55434 }, child, controls: controls() });
    expect(result.state).toBe('uncertain');
    expect(result.reason).toContain('exit 1');
  });

  it('fails a Postgres timeout without SIGKILL', async () => {
    const child = new FakeChild(200, { exitOn: new Set() });
    const result = await stopService({ service: { name: 'postgres', kind: 'postgres', port: 55434 }, child, controls: controls({ clock: clock({ timeout: true }) }) });
    expect(child.signals).toEqual(['SIGINT']);
    expect(result.state).toBe('uncertain');
    expect(result.reason).toContain('30s');
  });

  it('fails a Postgres port that is still present', async () => {
    const child = new FakeChild(200);
    const result = await stopService({ service: { name: 'postgres', kind: 'postgres', port: 55434 }, child, controls: controls({ portState: 'present' }) });
    expect(result.state).toBe('uncertain');
    expect(result.reason).toContain('port present');
  });
});

describe('supervisor lifecycle', () => {
  it('starts services and writes a clean receipt on stop', async () => {
    const dir = tempDir();
    const app = new FakeChild(100);
    const postgres = new FakeChild(200);
    const children = [app, postgres];
    const supervisor = await startSupervisor({
      runDir: dir,
      services: [
        { name: 'app', kind: 'app', command: 'node', args: ['app'] },
        { name: 'postgres', kind: 'postgres', port: 55434, command: 'postgres', args: ['-D', dir] },
      ],
      controlPath: path.join(dir, 'control.json'),
      receiptPath: path.join(dir, 'receipt.json'),
      spawn: () => children.shift(),
      clock: clock(),
      controls: controls(),
    });
    const results = await supervisor.stop();
    expect(results.map((result) => result.state)).toEqual(['clean', 'clean']);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(true);
  });

  it('stops on handoff when no control request arrives', async () => {
    const dir = tempDir();
    const app = new FakeChild(100);
    const supervisor = await startSupervisor({
      runDir: dir,
      services: [{ name: 'app', kind: 'app', command: 'node', args: ['app'] }],
      controlPath: path.join(dir, 'control.json'),
      receiptPath: path.join(dir, 'receipt.json'),
      spawn: () => app,
      clock: clock(),
      controls: controls(),
      handoffMs: 1,
    });
    await supervisor.stop();
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(true);
  });

  it('reports an unreachable supervisor', async () => {
    const dir = tempDir();
    const receipt = await requestStop({ controlPath: path.join(dir, 'control.json'), receiptPath: path.join(dir, 'receipt.json'), timeoutMs: 0, clock: clock() });
    expect(receipt.ok).toBe(false);
    expect(receipt.reason).toContain('timeout');
  });
});

describe('in-process suite supervision', () => {
  it('stops Postgres after a failed suite command', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300);
    test.exit(1);
    const children = [postgres, test];
    const result = await runSupervised({
      services: [{ name: 'postgres', kind: 'postgres', port: 55434, command: 'postgres', args: ['-D', dir] }],
      command: ['npm', 'test'],
      controls: { ...controls(), spawn: () => children.shift() },
      receiptPath: path.join(dir, 'receipt.json'),
    });
    expect(result.code).toBe(1);
    expect(result.results[0]?.state).toBe('clean');
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(true);
  });

  it('stops Postgres after a startup exception', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    let calls = 0;
    const result = await runSupervised({
      services: [{ name: 'postgres', kind: 'postgres', port: 55434, command: 'postgres', args: ['-D', dir] }],
      command: ['npm', 'test'],
      controls: {
        ...controls(),
        spawn: () => {
          calls += 1;
          if (calls === 1) return postgres;
          throw new Error('spawn failed');
        },
      },
      receiptPath: path.join(dir, 'receipt.json'),
    });
    expect(result.code).toBe(1);
    expect(result.results[0]?.state).toBe('clean');
  });

  it('fails the receipt when Postgres crashes', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    postgres.kill = (signal: string) => {
      postgres.signals.push(signal);
      postgres.exit(1);
      return true;
    };
    const test = new FakeChild(300);
    test.exit(0);
    const children = [postgres, test];
    const result = await runSupervised({
      services: [{ name: 'postgres', kind: 'postgres', port: 55434, command: 'postgres', args: ['-D', dir] }],
      command: ['npm', 'test'],
      controls: { ...controls(), spawn: () => children.shift() },
      receiptPath: path.join(dir, 'receipt.json'),
    });
    expect(result.results[0]?.state).toBe('uncertain');
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
  });
});
