import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { requestStop, runSupervised, startSupervisor, stopService } from '../.claude/skills/verify-build-a-bucket/scripts/supervisor.mjs';
import type { Controls } from '../.claude/skills/verify-build-a-bucket/scripts/supervisor.mjs';
import { descendants } from '../.claude/skills/verify-build-a-bucket/scripts/process-control.mjs';
import { createStopOnce, startLocalDb } from '../scripts/local-db.mjs';

class FakeChild {
  pid: number;
  signals: string[] = [];
  exited = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  private exitOn: Set<string>;
  private listeners: ((code: number | null, signal: string | null) => void)[] = [];

  constructor(pid: number, { exitOn = new Set(['SIGTERM', 'SIGINT', 'SIGKILL']) } = {}) {
    this.pid = pid;
    this.exitOn = exitOn;
  }

  once(event: string, listener: (code: number | null, signal: string | null) => void) {
    if (event === 'exit') {
      if (this.exited) listener(this.exitCode, this.signalCode);
      else this.listeners.push(listener);
    }
    return this;
  }

  on(event: string, listener: (code: number | null, signal: string | null) => void) {
    return this.once(event, listener);
  }

  kill(signal: string) {
    this.signals.push(signal);
    if (this.exitOn.has(signal)) this.exit(signal === 'SIGKILL' ? null : 0, signal === 'SIGKILL' ? 'SIGKILL' : null);
    return true;
  }

  exit(code: number | null, signal: string | null = null) {
    this.exited = true;
    this.exitCode = code;
    this.signalCode = signal;
    for (const listener of this.listeners.splice(0)) listener(code, signal);
  }
}

function clock({ timeout = false } = {}) {
  const timers: (() => void)[] = [];
  return {
    timers,
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      if (timeout) fn();
      return 0;
    },
    setInterval: () => 0,
    clearInterval: () => {},
    clearTimeout: () => {},
  };
}

function controls({
  identities = new Map(),
  probes = new Map(),
  groups = new Map(),
  trees = new Map(),
  portState = 'absent' as 'present' | 'absent' | 'unknown',
  clock: c = clock(),
} = {}): Controls {
  return {
    readIdentity: (pid: number) => identities.get(pid) ?? null,
    groupMembers: (pgid: number) => groups.get(pgid) ?? { ok: true, members: [] },
    descendants: (pid: number) => trees.get(pid) ?? { ok: true, pids: [] },
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

  it('finds a worker only through the group relation', async () => {
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

  it('finds a worker only through the ppid tree', async () => {
    const child = new FakeChild(100);
    const result = await stopService({
      service: { name: 'app', kind: 'app' },
      child,
      controls: controls({ trees: new Map([[100, { ok: true, pids: [101] }]]), probes: new Map([[101, 'present']]) }),
    });
    expect(result.state).toBe('uncertain');
    expect(result.reason).toContain('101');
  });

  it('fails an already-exited app with a live worker', async () => {
    const child = new FakeChild(100);
    child.exit(1);
    const worker = { pid: 101, startTime: 'x', command: 'worker', pgid: 100 };
    const result = await stopService({
      service: { name: 'app', kind: 'app' },
      child,
      controls: controls({ groups: new Map([[100, { ok: true, members: [worker] }]]), probes: new Map([[101, 'present']]) }),
    });
    expect(child.signals).toEqual([]);
    expect(result.state).toBe('uncertain');
  });

  it('passes an already-exited app with no live members', async () => {
    const child = new FakeChild(100);
    child.exit(0);
    const result = await stopService({ service: { name: 'app', kind: 'app' }, child, controls: controls() });
    expect(child.signals).toEqual([]);
    expect(result.state).toBe('clean');
  });

  it('fails a group enumeration error', async () => {
    const child = new FakeChild(100);
    const result = await stopService({
      service: { name: 'app', kind: 'app' },
      child,
      controls: controls({ groups: new Map([[100, { ok: false, reason: 'ps failed' }]]) }),
    });
    expect(result.state).toBe('uncertain');
    expect(result.reason).toContain('enumeration failed');
  });

  it('stops Postgres with SIGINT and requires exit 0 and an absent port', async () => {
    const child = new FakeChild(200);
    const result = await stopService({ service: { name: 'postgres', kind: 'postgres', port: 55434 }, child, controls: controls() });
    expect(child.signals).toEqual(['SIGINT']);
    expect(result.state).toBe('clean');
  });

  it('passes an already-exited Postgres with code 0 and an absent port', async () => {
    const child = new FakeChild(200);
    child.exit(0);
    const result = await stopService({ service: { name: 'postgres', kind: 'postgres', port: 55434 }, child, controls: controls() });
    expect(child.signals).toEqual([]);
    expect(result.state).toBe('clean');
  });

  it('fails an already-exited Postgres with a non-zero code', async () => {
    const child = new FakeChild(200);
    child.exit(1);
    const result = await stopService({ service: { name: 'postgres', kind: 'postgres', port: 55434 }, child, controls: controls() });
    expect(child.signals).toEqual([]);
    expect(result.state).toBe('uncertain');
  });

  it('fails a Postgres timeout without SIGKILL', async () => {
    const child = new FakeChild(200, { exitOn: new Set() });
    const result = await stopService({ service: { name: 'postgres', kind: 'postgres', port: 55434 }, child, controls: controls({ clock: clock({ timeout: true }) }) });
    expect(child.signals).toEqual(['SIGINT']);
    expect(result.state).toBe('uncertain');
  });
});

describe('supervisor lifecycle', () => {
  it('initializes Postgres before spawning the app', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const app = new FakeChild(100);
    const order: string[] = [];
    const children = [postgres, app];
    const supervisor = await startSupervisor({
      runDir: dir,
      services: [{ name: 'app', kind: 'app', command: 'node', args: ['app'], envFromPostgres: true }],
      controlPath: path.join(dir, 'control.json'),
      receiptPath: path.join(dir, 'receipt.json'),
      ackPath: path.join(dir, 'ack.json'),
      postgresInit: {
        root: dir,
        port: 55434,
        database: 'bab_local',
        schema: '/schema.sql',
        initdb: ({ dataDir, sockDir, port }: { dataDir: string; sockDir: string; port: number }) => {
          writeFileSync(path.join(dataDir, 'postmaster.pid'), `${postgres.pid}\n`);
          writeFileSync(path.join(sockDir, `.s.PGSQL.${port}`), '');
        },
        psql: () => '1',
        schemaLoad: () => {
          order.push('schema');
        },
      },
      spawn: () => {
        const child = children.shift();
        order.push(child === postgres ? 'postgres' : 'app');
        return child;
      },
      clock: clock(),
      controls: controls(),
      exit: () => {},
    });
    expect(order).toEqual(['postgres', 'schema', 'app']);
    await supervisor.stop();
  });

  it('stops Postgres when the app spawn throws', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    let calls = 0;
    await startSupervisor({
      runDir: dir,
      services: [{ name: 'app', kind: 'app', command: 'node', args: ['app'] }],
      controlPath: path.join(dir, 'control.json'),
      receiptPath: path.join(dir, 'receipt.json'),
      ackPath: path.join(dir, 'ack.json'),
      postgresInit: {
        root: dir,
        port: 55434,
        database: 'bab_local',
        schema: '/schema.sql',
        initdb: ({ dataDir, sockDir, port }: { dataDir: string; sockDir: string; port: number }) => {
          writeFileSync(path.join(dataDir, 'postmaster.pid'), `${postgres.pid}\n`);
          writeFileSync(path.join(sockDir, `.s.PGSQL.${port}`), '');
        },
        psql: () => '1',
        schemaLoad: () => {},
      },
      spawn: () => {
        calls += 1;
        if (calls === 1) return postgres;
        throw new Error('app spawn failed');
      },
      clock: clock(),
      controls: controls(),
      exit: () => {},
    });
    expect(postgres.signals).toEqual(['SIGINT']);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    expect(receipt.reason).toContain('app spawn failed');
  });

  it('does not spawn the app when Postgres init fails', async () => {
    const dir = tempDir();
    let appSpawns = 0;
    await startSupervisor({
      runDir: dir,
      services: [{ name: 'app', kind: 'app', command: 'node', args: ['app'] }],
      controlPath: path.join(dir, 'control.json'),
      receiptPath: path.join(dir, 'receipt.json'),
      ackPath: path.join(dir, 'ack.json'),
      postgresInit: {
        root: dir,
        port: 55434,
        database: 'bab_local',
        schema: '/schema.sql',
        initdb: () => {
          throw new Error('init failed');
        },
        psql: () => '1',
        schemaLoad: () => {},
      },
      spawn: () => {
        appSpawns += 1;
        return new FakeChild(100);
      },
      clock: clock(),
      controls: controls(),
      exit: () => {},
    });
    expect(appSpawns).toBe(0);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
  });

  it('does not stop when the launch ack arrives', async () => {
    const dir = tempDir();
    const app = new FakeChild(100);
    const c = clock();
    const ackPath = path.join(dir, 'ack.json');
    writeFileSync(ackPath, 'ack\n');
    await startSupervisor({
      runDir: dir,
      services: [{ name: 'app', kind: 'app', command: 'node', args: ['app'] }],
      controlPath: path.join(dir, 'control.json'),
      receiptPath: path.join(dir, 'receipt.json'),
      ackPath,
      spawn: () => app,
      clock: c,
      controls: controls(),
      exit: () => {},
    });
    c.timers[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(app.signals).toEqual([]);
  });

  it('stops when the launch ack never arrives', async () => {
    const dir = tempDir();
    const app = new FakeChild(100);
    const c = clock();
    await startSupervisor({
      runDir: dir,
      services: [{ name: 'app', kind: 'app', command: 'node', args: ['app'] }],
      controlPath: path.join(dir, 'control.json'),
      receiptPath: path.join(dir, 'receipt.json'),
      ackPath: path.join(dir, 'ack.json'),
      spawn: () => app,
      clock: c,
      controls: controls(),
      exit: () => {},
    });
    c.timers[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(app.signals).toEqual(['SIGTERM']);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(true);
  });

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
      ackPath: path.join(dir, 'ack.json'),
      spawn: () => children.shift(),
      clock: clock(),
      controls: controls(),
      exit: () => {},
    });
    const results = await supervisor.stop();
    expect(results.map((result) => result.state)).toEqual(['clean', 'clean']);
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
  it('propagates a nested descendant enumeration failure', () => {
    const pgrep = (pid: number) => {
      if (pid === 100) return '101\n';
      throw Object.assign(new Error('failed'), { status: 2 });
    };
    expect(descendants(100, { pgrep })).toEqual({ ok: false, reason: 'failed' });
  });

  it('stops a child once through the shared guard', async () => {
    let calls = 0;
    const stop = createStopOnce(async () => {
      calls += 1;
      return { state: 'clean' };
    });
    await stop();
    await stop();
    expect(calls).toBe(1);
  });

  it('exposes the Postgres child as soon as it is spawned', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'PG_VERSION'), '14\n');
    const child = new FakeChild(200);
    let seen: FakeChild | null = null;
    const handle = await startLocalDb({
      dataDir: dir,
      pgPort: 55434,
      spawn: () => child,
      initdb: ({ dataDir, sockDir, port }: { dataDir: string; sockDir: string; port: number }) => {
        writeFileSync(path.join(dataDir, 'postmaster.pid'), `${child.pid}\n`);
        writeFileSync(path.join(sockDir, `.s.PGSQL.${port}`), '');
      },
      psql: () => '1',
      schemaLoad: () => {},
      onChild: (value: FakeChild) => {
        seen = value;
      },
    });
    expect(seen).toBe(child);
    expect(handle.child).toBe(child);
  });

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
