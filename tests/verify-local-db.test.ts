import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { main } from '../scripts/local-db.mjs';

class FakeChild {
  pid: number | undefined;
  signals: string[] = [];
  exited = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  private exitOn: Set<string>;
  private listeners = new Map<string, ((...args: any[]) => void)[]>();

  constructor(pid: number, { exitOn = new Set(['SIGTERM', 'SIGINT', 'SIGKILL']) } = {}) {
    this.pid = pid;
    this.exitOn = exitOn;
  }

  once(event: string, listener: (...args: any[]) => void) {
    if (event === 'exit' && this.exited) {
      listener(this.exitCode, this.signalCode);
      return this;
    }
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  on(event: string, listener: (...args: any[]) => void) {
    return this.once(event, listener);
  }

  removeListener(_event: string, listener: (...args: any[]) => void) {
    const list = this.listeners.get(_event) ?? [];
    this.listeners.set(_event, list.filter((item) => item !== listener));
    return this;
  }

  listenerCount(_event: string) {
    return (this.listeners.get(_event) ?? []).length;
  }

  emit(event: string, ...args: unknown[]) {
    if (event === 'exit') this.exit(args[0] as number, args[1] as string);
    else for (const listener of (this.listeners.get(event) ?? []).splice(0)) listener(...args);
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
    for (const listener of (this.listeners.get('exit') ?? []).splice(0)) listener(code, signal);
  }
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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'r27-main-'));
  temps.push(dir);
  return dir;
}

function initFor(child: FakeChild) {
  return ({ dataDir, sockDir, port }: { dataDir: string; sockDir: string; port: number }) => {
    writeFileSync(path.join(dataDir, 'postmaster.pid'), `${child.pid}\n`);
    writeFileSync(path.join(sockDir, `.s.PGSQL.${port}`), '');
  };
}

const clock = { setTimeout: (fn: () => void) => fn(), setInterval: () => 0, clearInterval: () => {}, clearTimeout: () => {} };

describe('local-db main', () => {
  it('stops Postgres when the command spawn throws', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    let calls = 0;
    let code: number | null = null;
    await main({
      argv: ['--data-dir', dir, '--', 'npm', 'test'],
      spawn: () => {
        calls += 1;
        if (calls === 1) return postgres;
        throw new Error('spawn failed');
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: (value: number) => {
        code = value;
      },
    });
    expect(postgres.signals).toEqual(['SIGINT']);
    expect(code).toBe(1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
  });

  it('stops Postgres on SIGTERM during the command', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300, { exitOn: new Set(['SIGKILL']) });
    const signals = new EventEmitter();
    const order: string[] = [];
    test.on('exit', () => order.push('child-exit'));
    const kill = postgres.kill.bind(postgres);
    postgres.kill = (signal: string) => {
      order.push(`postgres-${signal}`);
      return kill(signal);
    };
    let calls = 0;
    let code: number | null = null;
    const promise = main({
      argv: ['--data-dir', dir, '--', 'npm', 'test'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      signals,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: (value: number) => {
        code = value;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    signals.emit('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await promise;
    expect(test.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(postgres.signals).toEqual(['SIGINT']);
    expect(code).toBe(1);
    expect(order).toEqual(['child-exit', 'postgres-SIGINT']);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(true);
    expect(receipt.services[0]?.state).toBe('clean');
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    expect(signals.listenerCount('SIGINT')).toBe(0);
  });

  it('skips the wait when the command child already exited', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200, { exitOn: new Set() });
    const test = new FakeChild(300);
    test.exit(0);
    const signals = new EventEmitter();
    let calls = 0;
    let code: number | null = null;
    const promise = main({
      argv: ['--data-dir', dir, '--', 'npm', 'test'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock: { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 20)) },
      signals,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: (value: number) => {
        code = value;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    signals.emit('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 10));
    postgres.exit(0);
    await promise;
    expect(postgres.signals).toEqual(['SIGINT']);
    expect(code).toBe(1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(true);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    expect(signals.listenerCount('SIGINT')).toBe(0);
  });

  it('keeps everything when the command never exits', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300, { exitOn: new Set() });
    test.pid = undefined;
    const signals = new EventEmitter();
    let calls = 0;
    let code: number | null = null;
    const promise = main({
      argv: ['--data-dir', dir, '--', 'npm', 'test'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      signals,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: (value: number) => {
        code = value;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    signals.emit('SIGTERM');
    await promise;
    expect(test.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(postgres.signals).toEqual(['SIGINT']);
    expect(code).toBe(1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    expect(receipt.command.state).toBe('uncertain');
    expect(existsSync(dir)).toBe(true);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    expect(signals.listenerCount('SIGINT')).toBe(0);
  });

  it('shares one shutdown across repeated signals', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300, { exitOn: new Set(['SIGKILL']) });
    const signals = new EventEmitter();
    let calls = 0;
    let exits = 0;
    const promise = main({
      argv: ['--data-dir', dir, '--', 'npm', 'test'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      signals,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: () => {
        exits += 1;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    signals.emit('SIGTERM');
    signals.emit('SIGTERM');
    signals.emit('SIGTERM');
    await promise;
    expect(test.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(postgres.signals).toEqual(['SIGINT']);
    expect(exits).toBe(1);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    expect(signals.listenerCount('SIGINT')).toBe(0);
  });

  it('does not spawn the command when a signal arrives during startup', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const signals = new EventEmitter();
    let spawns = 0;
    let code: number | null = null;
    const promise = main({
      argv: ['--data-dir', dir, '--', 'npm', 'test'],
      spawn: () => {
        spawns += 1;
        return postgres;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      signals,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: (value: number) => {
        code = value;
      },
    });
    signals.emit('SIGTERM');
    await promise;
    expect(spawns).toBe(1);
    expect(code).toBe(1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(true);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    expect(signals.listenerCount('SIGINT')).toBe(0);
  });

  it('fails promptly on an async command spawn error', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300, { exitOn: new Set() });
    test.pid = undefined;
    let calls = 0;
    let code: number | null = null;
    const promise = main({
      argv: ['--data-dir', dir, '--', 'npm', 'test'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: (value: number) => {
        code = value;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    test.emit('error', new Error('spawn ENOENT'));
    await promise;
    expect(postgres.signals).toEqual(['SIGINT']);
    expect(code).toBe(1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    expect(receipt.reason).toContain('spawn ENOENT');
    expect(receipt.command.state).toBe('spawn-error');
  });

  it('does not treat a kill error as a command exit', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300, { exitOn: new Set() });
    test.kill = (signal: string) => {
      test.signals.push(signal);
      test.emit('error', new Error('kill error'));
      return true;
    };
    const signals = new EventEmitter();
    let calls = 0;
    let code: number | null = null;
    const promise = main({
      argv: ['--data-dir', dir, '--', 'npm', 'test'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      signals,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: (value: number) => {
        code = value;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    signals.emit('SIGTERM');
    await promise;
    expect(test.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(postgres.signals).toEqual(['SIGINT']);
    expect(code).toBe(1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    expect(receipt.command.state).toBe('uncertain');
    expect(receipt.command.error).toBe('kill error');
    expect(existsSync(dir)).toBe(true);
    expect(test.listenerCount('exit')).toBe(0);
    expect(test.listenerCount('error')).toBe(0);
  });

  it('does not treat a false kill as a command exit', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300, { exitOn: new Set() });
    test.kill = () => false;
    const signals = new EventEmitter();
    let calls = 0;
    let code: number | null = null;
    const promise = main({
      argv: ['--data-dir', dir, '--', 'npm', 'test'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      signals,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: (value: number) => {
        code = value;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    signals.emit('SIGTERM');
    await promise;
    expect(postgres.signals).toEqual(['SIGINT']);
    expect(code).toBe(1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    expect(receipt.command.state).toBe('uncertain');
    expect(existsSync(dir)).toBe(true);
  });

  it('does not treat a throwing kill as a command exit', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300, { exitOn: new Set() });
    test.kill = () => {
      throw new Error('kill failed');
    };
    const signals = new EventEmitter();
    let calls = 0;
    let code: number | null = null;
    const promise = main({
      argv: ['--data-dir', dir, '--', 'npm', 'test'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      signals,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: (value: number) => {
        code = value;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    signals.emit('SIGTERM');
    await promise;
    expect(postgres.signals).toEqual(['SIGINT']);
    expect(code).toBe(1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    expect(receipt.command.state).toBe('uncertain');
    expect(receipt.command.error).toBe('kill failed');
    expect(existsSync(dir)).toBe(true);
  });

  it('keeps the error when the command exits late during stop', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300, { exitOn: new Set() });
    test.kill = (signal: string) => {
      test.signals.push(signal);
      test.emit('error', new Error('late error'));
      test.exit(0);
      return true;
    };
    const signals = new EventEmitter();
    let calls = 0;
    let code: number | null = null;
    const promise = main({
      argv: ['--data-dir', dir, '--', 'npm', 'test'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      signals,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: (value: number) => {
        code = value;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    signals.emit('SIGTERM');
    await promise;
    expect(test.signals).toEqual(['SIGTERM']);
    expect(postgres.signals).toEqual(['SIGINT']);
    expect(code).toBe(1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    expect(receipt.command.state).toBe('exited');
    expect(receipt.command.error).toBe('late error');
    expect(existsSync(dir)).toBe(true);
    expect(test.listenerCount('exit')).toBe(0);
    expect(test.listenerCount('error')).toBe(0);
  });

  it('keeps the error when the command exits after an error', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300);
    const signals = new EventEmitter();
    let calls = 0;
    let code: number | null = null;
    const promise = main({
      argv: ['--data-dir', dir, '--', 'npm', 'test'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      signals,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: (value: number) => {
        code = value;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    test.emit('error', new Error('early error'));
    test.exit(0);
    await promise;
    expect(postgres.signals).toEqual(['SIGINT']);
    expect(code).toBe(1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    expect(receipt.command.state).toBe('exited');
    expect(receipt.command.error).toBe('early error');
    expect(existsSync(dir)).toBe(true);
    expect(test.listenerCount('exit')).toBe(0);
    expect(test.listenerCount('error')).toBe(0);
  });

  it('fails a nonzero command exit', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300);
    test.exit(1);
    const signals = new EventEmitter();
    let calls = 0;
    let code: number | null = null;
    await main({
      argv: ['--data-dir', dir, '--', 'npm', 'test'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      signals,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: (value: number) => {
        code = value;
      },
    });
    expect(postgres.signals).toEqual(['SIGINT']);
    expect(code).toBe(1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    expect(receipt.command.state).toBe('exited');
    expect(receipt.command.code).toBe(1);
    expect(existsSync(dir)).toBe(true);
  });

  it('fails promptly on an async Postgres spawn error', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200, { exitOn: new Set() });
    postgres.pid = undefined as unknown as number;
    let sql = 0;
    let code: number | null = null;
    const promise = main({
      argv: ['--data-dir', dir, '--', 'npm', 'test'],
      spawn: () => postgres,
      initdb: () => {},
      psql: () => {
        sql += 1;
        return '1';
      },
      schemaLoad: () => {},
      clock,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: (value: number) => {
        code = value;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    postgres.emit('error', new Error('spawn ENOENT'));
    await promise;
    expect(sql).toBe(0);
    expect(postgres.signals).toEqual([]);
    expect(code).toBe(1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    expect(receipt.services[0]?.reason).toContain('not started');
  });

  it('exits non-zero when the Postgres stop is uncertain', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200, { exitOn: new Set() });
    const test = new FakeChild(300);
    test.exit(0);
    let calls = 0;
    let code: number | null = null;
    await main({
      argv: ['--data-dir', dir, '--', 'npm', 'test'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: (value: number) => {
        code = value;
      },
    });
    expect(code).toBe(1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
  });

  it('passes an empty listen address through local-db main', async () => {
    const dir = tempDir();
    const argvFile = path.join(dir, 'argv.txt');
    writeFileSync(path.join(dir, 'postgres'), `#!/bin/sh\nprintf '%s\\n' "$@" > "$ARGV_FILE"\nexit 3\n`);
    chmodSync(path.join(dir, 'postgres'), 0o755);
    const previous = process.env.BAB_PG_BIN;
    process.env.BAB_PG_BIN = dir;
    process.env.ARGV_FILE = argvFile;
    const realClock = { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 20)), setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, clearTimeout: globalThis.clearTimeout };
    let code: number | null = null;
    try {
      await main({
        argv: ['--data-dir', dir, '--', 'true'],
        initdb: () => {},
        psql: () => '1',
        schemaLoad: () => {},
        clock: realClock,
        receiptPath: path.join(dir, 'receipt.json'),
        exit: (value: number) => {
          code = value;
        },
      });
    } finally {
      if (previous === undefined) delete process.env.BAB_PG_BIN;
      else process.env.BAB_PG_BIN = previous;
      delete process.env.ARGV_FILE;
    }
    for (let attempt = 0; attempt < 50 && !existsSync(argvFile); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    const args = readFileSync(argvFile, 'utf8').trim().split('\n');
    expect(args).toContain('listen_addresses=');
    expect(args).not.toContain("listen_addresses=''");
    expect(code).toBe(1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(false);
    expect(receipt.services[0]?.reason).toContain('exit 3');
  });

  it('removes its signal listeners when it returns', async () => {
    const before = process.listenerCount('SIGINT') + process.listenerCount('SIGTERM');
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300);
    test.exit(0);
    let calls = 0;
    await main({
      argv: ['--data-dir', dir, '--', 'true'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: () => {},
    });
    const after = process.listenerCount('SIGINT') + process.listenerCount('SIGTERM');
    expect(after).toBe(before);
  });

  it('removes the created data root after a clean stop', async () => {
    const before = readdirSync(process.env.TMPDIR!).filter((name) => name.startsWith('bab-local-db-')).length;
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300);
    test.exit(0);
    let calls = 0;
    await main({
      argv: ['--', 'true'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: () => {},
    });
    const after = readdirSync(process.env.TMPDIR!).filter((name) => name.startsWith('bab-local-db-')).length;
    expect(after).toBe(before);
  });

  it('keeps the created data root after a failed stop', async () => {
    const before = readdirSync(process.env.TMPDIR!).filter((name) => name.startsWith('bab-local-db-')).length;
    const dir = tempDir();
    const postgres = new FakeChild(200, { exitOn: new Set() });
    const test = new FakeChild(300);
    test.exit(0);
    let calls = 0;
    await main({
      argv: ['--', 'true'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: () => {},
    });
    const after = readdirSync(process.env.TMPDIR!).filter((name) => name.startsWith('bab-local-db-')).length;
    expect(after).toBe(before + 1);
  });

  it('keeps the created data root with --keep', async () => {
    const before = readdirSync(process.env.TMPDIR!).filter((name) => name.startsWith('bab-local-db-')).length;
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300);
    test.exit(0);
    let calls = 0;
    await main({
      argv: ['--keep', '--', 'true'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: () => {},
    });
    const after = readdirSync(process.env.TMPDIR!).filter((name) => name.startsWith('bab-local-db-')).length;
    expect(after).toBe(before + 1);
  });

  it('does not remove a caller data dir', async () => {
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300);
    test.exit(0);
    let calls = 0;
    await main({
      argv: ['--data-dir', dir, '--', 'true'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: initFor(postgres),
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: () => {},
    });
    expect(existsSync(dir)).toBe(true);
  });

  it('keeps a non-empty created root and still writes a clean receipt', async () => {
    const before = readdirSync(process.env.TMPDIR!).filter((name) => name.startsWith('bab-local-db-')).length;
    const dir = tempDir();
    const postgres = new FakeChild(200);
    const test = new FakeChild(300);
    test.exit(0);
    let calls = 0;
    await main({
      argv: ['--', 'true'],
      spawn: () => {
        calls += 1;
        return calls === 1 ? postgres : test;
      },
      initdb: ({ dataDir, sockDir, port }: { dataDir: string; sockDir: string; port: number }) => {
        writeFileSync(path.join(dataDir, 'postmaster.pid'), `${postgres.pid}\n`);
        writeFileSync(path.join(sockDir, `.s.PGSQL.${port}`), '');
        writeFileSync(path.join(path.dirname(dataDir), 'extra.txt'), 'x');
      },
      psql: () => '1',
      schemaLoad: () => {},
      clock,
      receiptPath: path.join(dir, 'receipt.json'),
      exit: () => {},
    });
    const after = readdirSync(process.env.TMPDIR!).filter((name) => name.startsWith('bab-local-db-')).length;
    expect(after).toBe(before + 1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.ok).toBe(true);
  });

  it('never touches the real process signal surface', async () => {
    const seen: string[] = [];
    const handlers: Record<string, () => void> = {
      SIGTERM: () => seen.push('SIGTERM'),
      SIGINT: () => seen.push('SIGINT'),
      uncaughtException: () => seen.push('uncaughtException'),
      unhandledRejection: () => seen.push('unhandledRejection'),
    };
    for (const [event, handler] of Object.entries(handlers)) process.on(event, handler);
    try {
      const dir = tempDir();
      const postgres = new FakeChild(200);
      const test = new FakeChild(300, { exitOn: new Set() });
      const signals = new EventEmitter();
      let calls = 0;
      const promise = main({
        argv: ['--data-dir', dir, '--', 'npm', 'test'],
        spawn: () => {
          calls += 1;
          return calls === 1 ? postgres : test;
        },
        initdb: initFor(postgres),
        psql: () => '1',
        schemaLoad: () => {},
        clock,
        signals,
        receiptPath: path.join(dir, 'receipt.json'),
        exit: () => {},
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      signals.emit('SIGTERM');
      await promise;
      expect(seen).toEqual([]);
      for (const [event, handler] of Object.entries(handlers)) expect(process.listeners(event as any)).toContain(handler);
    } finally {
      for (const [event, handler] of Object.entries(handlers)) process.removeListener(event, handler);
    }
  });
});
