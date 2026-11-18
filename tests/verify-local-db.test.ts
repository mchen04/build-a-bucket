import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../scripts/local-db.mjs';

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

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
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
    const test = new FakeChild(300, { exitOn: new Set() });
    let calls = 0;
    let code: number | null = null;
    void main({
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
    process.emit('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(postgres.signals).toEqual(['SIGINT']);
    expect(code).toBe(1);
    const receipt = JSON.parse(readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    expect(receipt.services[0]?.state).toBe('clean');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });
});
