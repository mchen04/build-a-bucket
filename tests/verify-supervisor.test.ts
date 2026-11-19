import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { requestStop, runSupervised, runSupervisorCli, startSupervisor, stopService } from '../.claude/skills/verify-build-a-bucket/scripts/supervisor.mjs';
import type { Controls } from '../.claude/skills/verify-build-a-bucket/scripts/supervisor.mjs';
import { descendants } from '../.claude/skills/verify-build-a-bucket/scripts/process-control.mjs';
import { createStopOnce, startLocalDb } from '../scripts/local-db.mjs';
import { buildSupervisorSpec } from '../.claude/skills/verify-build-a-bucket/scripts/supervisor-spec.mjs';
import { createOwnedPostgres } from '../.claude/skills/verify-build-a-bucket/scripts/owned-postgres.mjs';
import { removeOwnedDirs } from '../.claude/skills/verify-build-a-bucket/scripts/owned-dirs.mjs';
import { applyLeagueFixture, fixtureRunFrom } from '../.claude/skills/verify-build-a-bucket/scripts/league-fixture.mjs';

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
    } else if (event === 'error') {
      this.listeners.push(listener);
    }
    return this;
  }

  on(event: string, listener: (code: number | null, signal: string | null) => void) {
    return this.once(event, listener);
  }

  emit(event: string, ...args: unknown[]) {
    if (event === 'exit') this.exit(args[0] as number, args[1] as string);
    else for (const listener of this.listeners.splice(0)) listener(args[0] as number, args[1] as string);
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
  probe: probeFn = (pid: number) => probes.get(pid) ?? 'absent',
  clock: c = clock({ timeout: true }),
} = {}): Controls {
  return {
    readIdentity: (pid: number) => identities.get(pid) ?? null,
    groupMembers: (pgid: number) => groups.get(pgid) ?? { ok: true, members: [] },
    descendants: (pid: number) => trees.get(pid) ?? { ok: true, pids: [] },
    probe: probeFn,
    probePort: () => portState,
    clock: c,
  };
}

const temps: string[] = [];
const previousTmp = process.env.TMPDIR;
const ownedTmp = mkdtempSync(path.join(os.tmpdir(), 'bab-test-'));
process.env.TMPDIR = ownedTmp;
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(() => {
  if (previousTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = previousTmp;
  rmSync(ownedTmp, { recursive: true, force: true });
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
      clock: clock({ timeout: true }),
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

describe('supervisor CLI', () => {
  function specFor(dir: string, prepared: { pgPort: number; database: string } | null, postgres: FakeChild, order: string[] = []) {
    const spec: any = buildSupervisorSpec({ mode: 'dev', port: 4391, dir, repo: '/repo', prepared });
    if (prepared) {
      spec.postgresInit.initdb = ({ dataDir, sockDir, port }: { dataDir: string; sockDir: string; port: number }) => {
        writeFileSync(path.join(dataDir, 'postmaster.pid'), `${postgres.pid}\n`);
        writeFileSync(path.join(sockDir, `.s.PGSQL.${port}`), '');
      };
      spec.postgresInit.psql = () => '1';
      spec.postgresInit.schemaLoad = () => {
        order.push('schema');
      };
    }
    return spec;
  }

  it('initializes Postgres and spawns the app with the socket env', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const app = new FakeChild(100);
    const order: string[] = [];
    const children = [postgres, app];
    const spec = specFor(dir, { pgPort: 55434, database: 'bab_local' }, postgres, order);
    const specPath = path.join(dir, 'spec.json');
    writeFileSync(specPath, JSON.stringify(spec));
    const supervisor = await startSupervisor({
      runDir: dir,
      services: spec.services,
      controlPath: path.join(dir, 'control.json'),
      receiptPath: path.join(dir, 'receipt.json'),
      ackPath: path.join(dir, 'ack.json'),
      postgresInit: spec.postgresInit,
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

  it('passes the socket check with a replay-length run dir', async () => {
    const dir = path.join(tempDir(), 'replay-r21', '20261118T124105Z', 'bab-home', '2026-11-18T12-41-05-000Z');
    mkdirSync(dir, { recursive: true });
    const postgres = new FakeChild(200);
    const spec = specFor(dir, { pgPort: 55434, database: 'bab_local' }, postgres);
    const owned = await createOwnedPostgres({ ...spec.postgresInit, spawn: () => postgres, clock: { setTimeout: (fn: () => void) => fn() } });
    expect(owned.sockDir.startsWith(os.tmpdir())).toBe(true);
    expect(Buffer.byteLength(path.join(owned.sockDir, `.s.PGSQL.${owned.port}`))).toBeLessThanOrEqual(103);
  });

  it('stops Postgres and names it when init fails after spawn', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    let appSpawns = 0;
    let calls = 0;
    const spec = specFor(dir, { pgPort: 55434, database: 'bab_local' }, postgres);
    spec.postgresInit.psql = () => {
      throw new Error('init failed');
    };
    const specPath = path.join(dir, 'spec.json');
    writeFileSync(specPath, JSON.stringify(spec));
    const surface = new EventEmitter();
    const supervisor = await runSupervisorCli([dir, path.join(dir, 'control.json'), path.join(dir, 'receipt.json'), path.join(dir, 'ack.json'), specPath], {
      spawn: () => {
        calls += 1;
        if (calls === 1) return postgres;
        appSpawns += 1;
        return new FakeChild(100);
      },
      clock: clock({ timeout: true }),
      controls: controls(),
      events: surface,
      exit: () => {},
    });
    expect(appSpawns).toBe(0);
    expect(postgres.signals).toEqual(['SIGINT']);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    expect(receipt.services.some((service: { name: string }) => service.name === 'postgres')).toBe(true);
    await supervisor.stop();
    expect(surface.listenerCount('uncaughtException')).toBe(0);
    expect(surface.listenerCount('unhandledRejection')).toBe(0);
  });

  it('stops each child once when a service exits and errors', async () => {
    const dir = tempDir();
    const app = new FakeChild(100);
    const spec = specFor(dir, null, app);
    const specPath = path.join(dir, 'spec.json');
    writeFileSync(specPath, JSON.stringify(spec));
    const surface = new EventEmitter();
    const supervisor = await runSupervisorCli([dir, path.join(dir, 'control.json'), path.join(dir, 'receipt.json'), path.join(dir, 'ack.json'), specPath], {
      spawn: () => app,
      clock: clock(),
      controls: controls(),
      events: surface,
      exit: () => {},
    });
    app.exit(1);
    app.emit('error', new Error('boom'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(app.signals).toEqual([]);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    await supervisor.stop();
    expect(surface.listenerCount('uncaughtException')).toBe(0);
    expect(surface.listenerCount('unhandledRejection')).toBe(0);
  });

  it('cleans up on an uncaught exception', async () => {
    const dir = tempDir();
    const app = new FakeChild(100);
    const spec = specFor(dir, null, app);
    const specPath = path.join(dir, 'spec.json');
    writeFileSync(specPath, JSON.stringify(spec));
    const surface = new EventEmitter();
    await runSupervisorCli([dir, path.join(dir, 'control.json'), path.join(dir, 'receipt.json'), path.join(dir, 'ack.json'), specPath], {
      spawn: () => app,
      clock: clock(),
      controls: controls(),
      events: surface,
      exit: () => {},
    });
    surface.emit('uncaughtException', new Error('boom'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(app.signals).toEqual(['SIGTERM']);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    expect(surface.listenerCount('uncaughtException')).toBe(0);
    expect(surface.listenerCount('unhandledRejection')).toBe(0);
  });
});

describe('owned database evidence', () => {
  it('keeps inherited env out of the spec and passes it to the app', async () => {
    const dir = tempDir();
    process.env.BAB_SENTINEL = 'sentinel-value';
    const spec = buildSupervisorSpec({ mode: 'dev', port: 4391, dir, repo: '/repo', prepared: null });
    const specPath = path.join(dir, 'spec.json');
    writeFileSync(specPath, JSON.stringify(spec));
    const text = readFileSync(specPath, 'utf8');
    expect(text).not.toContain('BAB_SENTINEL');
    expect(text).not.toContain('sentinel-value');
    const app = new FakeChild(100);
    let captured: any = null;
    await startSupervisor({
      runDir: dir,
      services: spec.services,
      controlPath: path.join(dir, 'control.json'),
      receiptPath: path.join(dir, 'receipt.json'),
      ackPath: path.join(dir, 'ack.json'),
      spawn: (_cmd: string, _args: string[], options: { env: Record<string, string> }) => {
        captured = options.env;
        return app;
      },
      clock: clock(),
      controls: controls(),
      exit: () => {},
    });
    expect(captured?.BAB_SENTINEL).toBe('sentinel-value');
    delete process.env.BAB_SENTINEL;
  });

  it('runs the CLI positive path with injected Postgres tools', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const app = new FakeChild(100);
    const order: string[] = [];
    const children = [postgres, app];
    let captured: any = null;
    const spec = buildSupervisorSpec({ mode: 'dev', port: 4391, dir, repo: '/repo', prepared: { pgPort: 55434, database: 'bab_local' } });
    const specPath = path.join(dir, 'spec.json');
    writeFileSync(specPath, JSON.stringify(spec));
    const surface = new EventEmitter();
    const supervisor = await runSupervisorCli([dir, path.join(dir, 'control.json'), path.join(dir, 'receipt.json'), path.join(dir, 'ack.json'), specPath], {
      spawn: (_cmd: string, _args: string[], options: { env: Record<string, string> }) => {
        const child = children.shift();
        order.push(child === postgres ? 'postgres' : 'app');
        if (child === app) captured = options.env;
        return child;
      },
      clock: clock(),
      controls: controls(),
      events: surface,
      exit: () => {},
      postgresTools: {
        initdb: ({ dataDir, sockDir, port }: { dataDir: string; sockDir: string; port: number }) => {
          writeFileSync(path.join(dataDir, 'postmaster.pid'), `${postgres.pid}\n`);
          writeFileSync(path.join(sockDir, `.s.PGSQL.${port}`), '');
        },
        psql: () => '1',
        schemaLoad: () => {
          order.push('schema');
        },
      },
    });
    expect(order).toEqual(['postgres', 'schema', 'app']);
    expect(captured?.BAB_PG_SOCKET_DIR).toBeTruthy();
    expect(captured?.BAB_DB_RUNNER).toBe(path.resolve('.claude/skills/verify-build-a-bucket/scripts/meter/local-pg.mjs'));
    await supervisor.stop();
    expect(surface.listenerCount('uncaughtException')).toBe(0);
    expect(surface.listenerCount('unhandledRejection')).toBe(0);
  });

  it('removes exactly the recorded data and socket dirs', () => {
    const dir = tempDir();
    const dataDir = path.join(dir, 'pgdata-x');
    const sockDir = path.join(os.tmpdir(), 'bab-pgsock-x');
    const other = path.join(dir, 'bab-pgsock-other');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(sockDir, { recursive: true });
    mkdirSync(other, { recursive: true });
    writeFileSync(path.join(dir, 'supervisor-init.json'), JSON.stringify({ dataDir, sockDir }));
    removeOwnedDirs(dir, true);
    expect(existsSync(dataDir)).toBe(false);
    expect(existsSync(sockDir)).toBe(false);
    expect(existsSync(other)).toBe(true);
  });
});

describe('supervisor async spawn errors', () => {
  it('fails promptly on an async Postgres spawn error', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200, { exitOn: new Set() });
    postgres.pid = undefined as unknown as number;
    let appSpawns = 0;
    let calls = 0;
    const spec = buildSupervisorSpec({ mode: 'dev', port: 4391, dir, repo: '/repo', prepared: { pgPort: 55434, database: 'bab_local' } });
    const specPath = path.join(dir, 'spec.json');
    writeFileSync(specPath, JSON.stringify(spec));
    const surface = new EventEmitter();
    const promise = runSupervisorCli([dir, path.join(dir, 'control.json'), path.join(dir, 'receipt.json'), path.join(dir, 'ack.json'), specPath], {
      spawn: () => {
        calls += 1;
        if (calls === 1) return postgres;
        appSpawns += 1;
        return new FakeChild(100);
      },
      clock: clock({ timeout: true }),
      controls: controls(),
      events: surface,
      exit: () => {},
      postgresTools: { initdb: () => {}, psql: () => '1', schemaLoad: () => {} },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    postgres.emit('error', new Error('spawn ENOENT'));
    const supervisor = await promise;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(appSpawns).toBe(0);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    await supervisor.stop();
    expect(surface.listenerCount('uncaughtException')).toBe(0);
    expect(surface.listenerCount('unhandledRejection')).toBe(0);
  });

  it('fails promptly on an async app spawn error', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const app = new FakeChild(100, { exitOn: new Set() });
    app.pid = undefined as unknown as number;
    let calls = 0;
    const spec = buildSupervisorSpec({ mode: 'dev', port: 4391, dir, repo: '/repo', prepared: { pgPort: 55434, database: 'bab_local' } });
    const specPath = path.join(dir, 'spec.json');
    writeFileSync(specPath, JSON.stringify(spec));
    const surface = new EventEmitter();
    const promise = runSupervisorCli([dir, path.join(dir, 'control.json'), path.join(dir, 'receipt.json'), path.join(dir, 'ack.json'), specPath], {
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : app;
      },
      clock: clock(),
      controls: controls(),
      events: surface,
      exit: () => {},
      postgresTools: {
        initdb: ({ dataDir, sockDir, port }: { dataDir: string; sockDir: string; port: number }) => {
          writeFileSync(path.join(dataDir, 'postmaster.pid'), `${postgres.pid}\n`);
          writeFileSync(path.join(sockDir, `.s.PGSQL.${port}`), '');
        },
        psql: () => '1',
        schemaLoad: () => {},
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    app.emit('error', new Error('spawn ENOENT'));
    const supervisor = await promise;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(postgres.signals).toEqual(['SIGINT']);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    await supervisor.stop();
    expect(surface.listenerCount('uncaughtException')).toBe(0);
    expect(surface.listenerCount('unhandledRejection')).toBe(0);
  });
});

describe('supervisor argv', () => {
  it('passes an empty listen address through the supervisor CLI', async () => {
    const dir = tempDir();
    const argvFile = path.join(dir, 'argv.txt');
    writeFileSync(path.join(dir, 'postgres'), `#!/bin/sh\nprintf '%s\\n' "$@" > "$ARGV_FILE"\nexit 3\n`);
    chmodSync(path.join(dir, 'postgres'), 0o755);
    const previous = process.env.BAB_PG_BIN;
    process.env.BAB_PG_BIN = dir;
    process.env.ARGV_FILE = argvFile;
    const realClock = { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 20)), setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, clearTimeout: globalThis.clearTimeout };
    const spec = buildSupervisorSpec({ mode: 'dev', port: 4391, dir, repo: '/repo', prepared: { pgPort: 55434, database: 'bab_local' } });
    const specPath = path.join(dir, 'spec.json');
    writeFileSync(specPath, JSON.stringify(spec));
    const surface = new EventEmitter();
    try {
      const supervisor = await runSupervisorCli([dir, path.join(dir, 'control.json'), path.join(dir, 'receipt.json'), path.join(dir, 'ack.json'), specPath], {
        clock: realClock,
        controls: controls(),
        events: surface,
        exit: () => {},
        postgresTools: { initdb: () => {}, psql: () => '1', schemaLoad: () => {} },
      });
      await supervisor.stop();
    } finally {
      if (previous === undefined) delete process.env.BAB_PG_BIN;
      else process.env.BAB_PG_BIN = previous;
      delete process.env.ARGV_FILE;
    }
    for (let attempt = 0; attempt < 50 && !existsSync(argvFile); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    const args = readFileSync(argvFile, 'utf8').trim().split('\n');
    expect(args).toContain('listen_addresses=');
    expect(args).not.toContain("listen_addresses=''");
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    expect(receipt.services[0]?.reason).toContain('exit 3');
    expect(surface.listenerCount('uncaughtException')).toBe(0);
    expect(surface.listenerCount('unhandledRejection')).toBe(0);
  });
});

describe('app drain', () => {
  it('drains a descendant that disappears', async () => {
    const child = new FakeChild(100);
    let calls = 0;
    const result = await stopService({
      service: { name: 'app', kind: 'app' },
      child,
      controls: controls({ trees: new Map([[100, { ok: true, pids: [101] }]]), probe: () => (++calls <= 2 ? 'present' : 'absent') }),
    });
    expect(result.state).toBe('clean');
  });

  it('fails a persistent descendant at the deadline', async () => {
    const child = new FakeChild(100);
    const result = await stopService({
      service: { name: 'app', kind: 'app' },
      child,
      controls: controls({ trees: new Map([[100, { ok: true, pids: [101] }]]), probe: () => 'present' }),
    });
    expect(result.state).toBe('uncertain');
    expect(result.reason).toContain('101');
  });

  it('fails an unknown probe at once', async () => {
    const child = new FakeChild(100);
    const result = await stopService({
      service: { name: 'app', kind: 'app' },
      child,
      controls: controls({ trees: new Map([[100, { ok: true, pids: [101] }]]), probe: () => 'unknown' }),
    });
    expect(result.state).toBe('uncertain');
    expect(result.reason).toContain('unknown');
  });

  it('drains a group member that lingers then exits', async () => {
    const child = new FakeChild(100);
    let calls = 0;
    const result = await stopService({
      service: { name: 'app', kind: 'app' },
      child,
      controls: controls({ groups: new Map([[100, { ok: true, members: [{ pid: 101, startTime: 'x', command: 'worker', pgid: 100 }] }]]), probe: () => (++calls <= 2 ? 'present' : 'absent') }),
    });
    expect(result.state).toBe('clean');
  });

  it('drains an already-exited root with a disappearing descendant', async () => {
    const child = new FakeChild(100);
    child.exit(0);
    let calls = 0;
    const result = await stopService({
      service: { name: 'app', kind: 'app' },
      child,
      controls: controls({ trees: new Map([[100, { ok: true, pids: [101] }]]), probe: () => (++calls <= 2 ? 'present' : 'absent') }),
    });
    expect(result.state).toBe('clean');
  });

  it('fails an already-exited root with a persistent descendant', async () => {
    const child = new FakeChild(100);
    child.exit(0);
    const result = await stopService({
      service: { name: 'app', kind: 'app' },
      child,
      controls: controls({ trees: new Map([[100, { ok: true, pids: [101] }]]), probe: () => 'present' }),
    });
    expect(result.state).toBe('uncertain');
  });

  it('fails an already-exited root with an unknown probe', async () => {
    const child = new FakeChild(100);
    child.exit(0);
    const result = await stopService({
      service: { name: 'app', kind: 'app' },
      child,
      controls: controls({ trees: new Map([[100, { ok: true, pids: [101] }]]), probe: () => 'unknown' }),
    });
    expect(result.state).toBe('uncertain');
  });
});

describe('supervisor record binds the fixture', () => {
  const entry = { id: 'fx', mode: 'normal', era: 'current', players: 1, code: 'ABC123', secret: 's', expectedClass: 'qualifying' as const, qualifyingSeats: [1], participants: [{ id: 'p1', seat: 1, name: 'Ava', team: 'ATL', build: { kind: 'normal' }, summary: {} }] };
  async function launched() {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const app = new FakeChild(100);
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
          writeFileSync(path.join(dataDir, 'postmaster.pid'), `${postgres.pid}\n${dataDir}\n0\n${port}\n${sockDir}\n`);
          writeFileSync(path.join(sockDir, `.s.PGSQL.${port}`), '');
        },
        psql: () => '1',
        schemaLoad: () => {},
      },
      spawn: () => children.shift(),
      clock: clock(),
      controls: controls(),
      exit: () => {},
    });
    const record = JSON.parse(readFileSync(path.join(dir, 'supervisor.json'), 'utf8'));
    const init = JSON.parse(readFileSync(path.join(dir, 'supervisor-init.json'), 'utf8'));
    const state = { mode: 'dev', localDb: { pgPort: 55434, database: 'bab_local' }, supervisor: { pid: record.pid } };
    return { supervisor, record, init, state };
  }
  async function bind(state: unknown, init: unknown, record: unknown) {
    const targets: unknown[] = [];
    const connect = async (target: unknown) => {
      targets.push(target);
      throw new Error('stop');
    };
    const run = fixtureRunFrom({ state, init, supervisor: record } as never);
    await applyLeagueFixture({ entry, run: { ...run, pidAlive: () => true }, connect, secrets: ['s'] } as never);
    return targets;
  }

  it('binds the database the launcher recorded', async () => {
    const { supervisor, record, init, state } = await launched();
    const targets: unknown[] = [];
    const connect = async (target: unknown) => {
      targets.push(target);
      throw new Error('stop');
    };
    const run = fixtureRunFrom({ state, init, supervisor: record } as never);
    await expect(applyLeagueFixture({ entry, run: { ...run, pidAlive: () => true }, connect, secrets: ['s'] } as never)).rejects.toThrow('stop');
    expect(targets).toEqual([{ socketDir: init.sockDir, port: 55434, database: 'bab_local' }]);
    await supervisor.stop();
  });

  it.each([
    ['no postgres record', (r: Record<string, any>) => { delete r.postgres; }, () => {}],
    ['pid 0', (r: Record<string, any>) => { r.postgres.pid = 0; }, () => {}],
    ['wrong port', (r: Record<string, any>) => { r.postgres.port = 55435; }, () => {}],
    ['other database', (r: Record<string, any>) => { r.postgres.database = 'other'; }, () => {}],
    ['other socket dir', (r: Record<string, any>) => { r.postgres.sockDir = '/elsewhere'; }, () => {}],
    ['init failed', () => {}, (i: Record<string, any>) => { i.state = 'failed'; }],
  ])('refuses %s before connecting', async (_name, patchRecord, patchInit) => {
    const { supervisor, record, init, state } = await launched();
    patchRecord(record);
    patchInit(init);
    let targets: unknown[] = [];
    await expect((async () => { targets = await bind(state, init, record); })()).rejects.toThrow();
    expect(targets).toEqual([]);
    await supervisor.stop();
  });
});
