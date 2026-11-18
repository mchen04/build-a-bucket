import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkReplay } from '../.claude/skills/verify-build-a-bucket/scripts/replay-check.mjs';
import { buildControlFixture } from '../.claude/skills/verify-build-a-bucket/scripts/replay-records.mjs';

const plan = {
  suite: [
    { id: '04-test-local-db', command: ['npm', 'run', 'test:local-db'], required: { files: { 'tests/league-api.test.ts': 2, 'tests/league-stage-defects.test.ts': 1, 'tests/migration.test.ts': 1 } } },
    { id: '05-e2e-local-db', command: ['npm', 'run', 'e2e:local-db'], required: { files: { 'e2e/lobby.spec.ts': 1 } } },
  ],
  runs: [{ name: 'run-a', players: 2, mode: 'normal', device: 'iphone', reloadSeat: null, awaySeat: null, hostLeave: false, args: [] }],
};
const head = '0123456789abcdef0123456789abcdef01234567';
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function control() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'r30-'));
  temps.push(dir);
  buildControlFixture({ out: dir, plan, head });
  return dir;
}

function check(dir: string) {
  return checkReplay({ out: dir, planPath: path.join(dir, 'plan.json'), expectedHead: head, cleanup: true });
}

const reportPath = (dir: string, step: string) => path.join(dir, 'suite', step, 'report.json');
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const write = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value));

describe('suite report gate', () => {
  it('passes a positive report', () => {
    expect(check(control()).ok).toBe(true);
  });

  it('fails a skipped league-api test', () => {
    const dir = control();
    const report = read(reportPath(dir, '04-test-local-db'));
    report.testResults[0].assertionResults[0].status = 'skipped';
    write(reportPath(dir, '04-test-local-db'), report);
    expect(check(dir).ok).toBe(false);
  });

  it('fails an absent league-api file', () => {
    const dir = control();
    const report = read(reportPath(dir, '04-test-local-db'));
    report.testResults = report.testResults.filter((file: { name: string }) => !file.name.endsWith('league-api.test.ts'));
    write(reportPath(dir, '04-test-local-db'), report);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a short count', () => {
    const dir = control();
    const report = read(reportPath(dir, '04-test-local-db'));
    report.testResults[0].assertionResults.pop();
    write(reportPath(dir, '04-test-local-db'), report);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing report', () => {
    const dir = control();
    rmSync(reportPath(dir, '04-test-local-db'));
    expect(check(dir).ok).toBe(false);
  });

  it('fails a skipped e2e lobby spec', () => {
    const dir = control();
    const report = read(reportPath(dir, '05-e2e-local-db'));
    report.testResults[0].assertionResults[0].status = 'skipped';
    write(reportPath(dir, '05-e2e-local-db'), report);
    expect(check(dir).ok).toBe(false);
  });
});
