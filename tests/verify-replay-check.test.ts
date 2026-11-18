import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkReplay } from '../.claude/skills/verify-build-a-bucket/scripts/replay-check.mjs';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const plan = {
  suite: [{ id: '01-typecheck', command: ['npm', 'run', 'typecheck'] }],
  runs: [
    { name: 'run-a', players: 2, mode: 'normal', device: 'iphone', reloadSeat: 2, args: ['--reload', '2'] },
    { name: 'run-b', players: 3, mode: 'normal', device: 'iphone', reloadSeat: null, args: ['--away', '3'] },
  ],
};

function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

function writeText(file: string, value: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, value);
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    champion: 'OKC are champions',
    playAgain: true,
    httpErrors: [
      { seat: 1, name: 'Ava', responses: [] },
      { seat: 2, name: 'Ben', responses: [] },
    ],
    errors: [
      { seat: 1, name: 'Ava', errors: [] },
      { seat: 2, name: 'Ben', errors: [] },
    ],
    reload: { ran: true, revision: { stage: 'Season', progress: '1 / 10' }, seats: ['1:Ava', '2:Ben'], rowsCompared: 20, coverage: 'ok' },
    ...overrides,
  };
}

type RunSpec = { runJson?: unknown; exit?: string; summary?: unknown | null };

function fixture({
  planOverride = plan,
  runs = {} as Record<string, RunSpec>,
  suite = { '01-typecheck': '0' } as Record<string, string>,
  meta = { head: 'abc' },
  tracked = { pid: 123, port: 4391, pgPort: 55434 } as unknown,
  cleanupExit = '0',
  cleanupCheck = 'pid=123\npid_alive=no\nport_listening=no\npg_port_listening=no\n',
} = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'r22-'));
  temps.push(dir);
  writeJson(path.join(dir, 'plan.json'), planOverride);
  writeJson(path.join(dir, 'meta.json'), meta);
  if (tracked !== null) writeJson(path.join(dir, 'tracked.json'), tracked);
  writeText(path.join(dir, 'cleanup.exit'), cleanupExit);
  writeText(path.join(dir, 'cleanup-check.txt'), cleanupCheck);
  for (const [id, exit] of Object.entries(suite)) writeText(path.join(dir, 'suite', id, 'exit'), exit);
  for (const run of planOverride.runs) {
    const runDir = path.join(dir, 'runs', run.name);
    const spec = runs[run.name] ?? {};
    writeJson(path.join(runDir, 'run.json'), spec.runJson ?? { label: run.name, players: run.players, mode: run.mode, device: run.device, reloadSeat: run.reloadSeat });
    writeText(path.join(runDir, 'exit'), spec.exit ?? '0');
    if (spec.summary !== null) {
      writeJson(path.join(runDir, 'evidence', 'league-2026-01-01T00-00-00-000Z-abc', 'summary.json'), spec.summary ?? summary());
    }
  }
  return dir;
}

function check(dir: string, options: { expectedHead?: string | null; cleanup?: boolean } = {}) {
  return checkReplay({ out: dir, planPath: path.join(dir, 'plan.json'), expectedHead: options.expectedHead ?? 'abc', cleanup: options.cleanup ?? true });
}

describe('replay checker', () => {
  it('passes a complete valid control', () => {
    const result = check(fixture());
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails a missing planned run', () => {
    const dir = fixture();
    rmSync(path.join(dir, 'runs', 'run-b'), { recursive: true, force: true });
    expect(check(dir).ok).toBe(false);
  });

  it('fails an extra run', () => {
    const dir = fixture();
    writeJson(path.join(dir, 'runs', 'run-c', 'run.json'), { label: 'run-c' });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing run.json', () => {
    const dir = fixture();
    rmSync(path.join(dir, 'runs', 'run-a', 'run.json'));
    expect(check(dir).ok).toBe(false);
  });

  it('fails a malformed run.json', () => {
    const dir = fixture();
    writeText(path.join(dir, 'runs', 'run-a', 'run.json'), '{');
    expect(check(dir).ok).toBe(false);
  });

  it('fails run.json that disagrees with the plan', () => {
    const dir = fixture({ runs: { 'run-a': { runJson: { label: 'run-a', players: 2, mode: 'normal', device: 'pixel', reloadSeat: 2 } } } });
    expect(check(dir).ok).toBe(false);
  });

  it('fails missing reload evidence for a planned reload', () => {
    const dir = fixture({ runs: { 'run-a': { summary: summary({ reload: { ran: false, revision: null, seats: [], rowsCompared: 0, coverage: 'reload did not run' } }) } } });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing httpErrors array', () => {
    const dir = fixture({ runs: { 'run-a': { summary: summary({ httpErrors: undefined }) } } });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing errors array', () => {
    const dir = fixture({ runs: { 'run-a': { summary: summary({ errors: undefined }) } } });
    expect(check(dir).ok).toBe(false);
  });

  it('fails an empty exit receipt', () => {
    const dir = fixture({ runs: { 'run-a': { exit: '' } } });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a nonzero exit receipt', () => {
    const dir = fixture({ runs: { 'run-a': { exit: '1' } } });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing suite receipt', () => {
    const dir = fixture({ suite: {} });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a nonzero suite receipt', () => {
    const dir = fixture({ suite: { '01-typecheck': '1' } });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a candidate head mismatch', () => {
    const dir = fixture({ meta: { head: 'def' } });
    expect(check(dir).ok).toBe(false);
  });

  it('fails missing cleanup tracking', () => {
    const dir = fixture({ tracked: null });
    expect(check(dir).ok).toBe(false);
  });

  it('fails an empty cleanup check file', () => {
    const dir = fixture({ cleanupCheck: '' });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a partial cleanup check file', () => {
    const dir = fixture({ cleanupCheck: 'pid_alive=no\n' });
    expect(check(dir).ok).toBe(false);
  });

  it('fails duplicate cleanup lines', () => {
    const dir = fixture({ cleanupCheck: 'pid=123\npid=123\npid_alive=no\nport_listening=no\npg_port_listening=no\n' });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a live cleanup result', () => {
    const dir = fixture({ cleanupCheck: 'pid=123\npid_alive=yes\nport_listening=no\npg_port_listening=no\n' });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a nonzero cleanup exit', () => {
    const dir = fixture({ cleanupExit: '1' });
    expect(check(dir).ok).toBe(false);
  });
});
