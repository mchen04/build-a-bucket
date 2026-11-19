import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkReplay } from '../.claude/skills/verify-build-a-bucket/scripts/replay-check.mjs';
import { buildControlFixture } from '../.claude/skills/verify-build-a-bucket/scripts/replay-records.mjs';

const projects = {
  'mobile-webkit': { 'e2e/lobby.spec.ts': 2, 'e2e/mobile.spec.ts': 4, 'e2e/modes.spec.ts': 7 },
  'mobile-chromium': { 'e2e/lobby.spec.ts': 2, 'e2e/mobile.spec.ts': 4, 'e2e/modes.spec.ts': 7 },
};
const qualifying = (name: string, fixture: string) => ({ name, players: 2, mode: 'normal', device: 'iphone', reloadSeat: 2, awaySeat: null, hostLeave: false, fixture, expectedClass: 'qualifying', args: ['--reload', '2', '--fixture', fixture] });
const plan = {
  suite: [
    { id: '04-test-local-db', command: ['npm', 'run', 'test:local-db'], required: { files: { 'tests/league-api.test.ts': 41, 'tests/league-stage-defects.test.ts': 22, 'tests/migration.test.ts': 1 } } },
    { id: '05-e2e-local-db', command: ['npm', 'run', 'e2e:local-db'], rootDir: 'e2e', required: { projects } },
  ],
  runs: [
    qualifying('run-a', 'fx-01'),
    { name: 'run-b', players: 3, mode: 'normal', device: 'iphone', reloadSeat: null, awaySeat: 3, hostLeave: false, fixture: null, expectedClass: null, args: ['--away', '3'] },
    { name: 'run-c', players: 3, mode: 'normal', device: 'iphone', reloadSeat: null, awaySeat: null, hostLeave: true, fixture: null, expectedClass: null, args: ['--host-leave'] },
    ...Array.from({ length: 11 }, (_, index) => qualifying(`run-q${String(index + 2).padStart(2, '0')}`, `fx-${String(index + 2).padStart(2, '0')}`)),
    { name: 'run-elim', players: 4, mode: 'squad', device: 'iphone', reloadSeat: 2, awaySeat: null, hostLeave: false, fixture: 'fx-elim', expectedClass: 'all-eliminated', args: ['--reload', '2', '--fixture', 'fx-elim'] },
    { name: 'run-ui', players: 4, mode: 'squad', device: 'iphone', reloadSeat: null, awaySeat: null, hostLeave: false, fixture: null, expectedClass: null, args: [] },
  ],
};
const head = '0123456789abcdef0123456789abcdef01234567';
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function control(source = plan) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'r31-'));
  temps.push(dir);
  await buildControlFixture({ out: dir, plan: source, head });
  return dir;
}

function check(dir: string) {
  return checkReplay({ out: dir, planPath: path.join(dir, 'plan.json'), expectedHead: head, cleanup: true });
}

const reportPath = (dir: string, step: string) => path.join(dir, 'suite', step, 'report.json');
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const write = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value));

function edit04(dir: string, edit: (report: any) => void) {
  const file = reportPath(dir, '04-test-local-db');
  const report = read(file);
  edit(report);
  write(file, report);
}

function edit05(dir: string, edit: (report: any) => void) {
  const file = reportPath(dir, '05-e2e-local-db');
  const report = read(file);
  edit(report);
  write(file, report);
}

function tests05(report: any) {
  return report.suites.flatMap((suite: any) => suite.specs.flatMap((spec: any) => spec.tests));
}

describe('suite report gate', () => {
  it('passes a positive report', async () => {
    expect(check(await control()).ok).toBe(true);
  });

  for (const file of ['tests/league-api.test.ts', 'tests/league-stage-defects.test.ts', 'tests/migration.test.ts']) {
    it(`fails a skipped ${file}`, async () => {
      const dir = await control();
      edit04(dir, (report) => {
        const entry = report.testResults.find((item: { name: string }) => item.name === file);
        entry.assertionResults[0].status = 'skipped';
      });
      expect(check(dir).ok).toBe(false);
    });

    it(`fails an absent ${file}`, async () => {
      const dir = await control();
      edit04(dir, (report) => {
        report.testResults = report.testResults.filter((item: { name: string }) => item.name !== file);
      });
      expect(check(dir).ok).toBe(false);
    });

    it(`fails a short ${file}`, async () => {
      const dir = await control();
      edit04(dir, (report) => {
        const entry = report.testResults.find((item: { name: string }) => item.name === file);
        entry.assertionResults.pop();
      });
      expect(check(dir).ok).toBe(false);
    });
  }

  it('fails when every result is emptied', async () => {
    const dir = await control();
    edit05(dir, (report) => {
      for (const test of tests05(report)) test.results = [];
    });
    expect(check(dir).ok).toBe(false);
  });

  it('fails when one project is duplicated and the other absent', async () => {
    const dir = await control();
    edit05(dir, (report) => {
      for (const suite of report.suites) {
        for (const spec of suite.specs) {
          const chromium = spec.tests.filter((test: any) => test.projectName === 'mobile-chromium');
          spec.tests = [...chromium, ...chromium];
        }
      }
    });
    expect(check(dir).ok).toBe(false);
  });

  it('fails when rootDir points at another checkout', async () => {
    const dir = await control();
    edit05(dir, (report) => {
      report.config.rootDir = '/tmp/other/e2e';
    });
    expect(check(dir).ok).toBe(false);
  });

  it('fails an expected failure', async () => {
    const dir = await control();
    edit05(dir, (report) => {
      const test = tests05(report)[0];
      test.expectedStatus = 'failed';
      test.status = 'expected';
      test.results = [{ status: 'failed' }];
    });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing results array', async () => {
    const dir = await control();
    edit05(dir, (report) => {
      delete tests05(report)[0].results;
    });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a skipped test', async () => {
    const dir = await control();
    edit05(dir, (report) => {
      tests05(report)[0].status = 'skipped';
    });
    expect(check(dir).ok).toBe(false);
  });

  it('fails one project partial', async () => {
    const dir = await control();
    edit05(dir, (report) => {
      const spec = report.suites[0].specs[0];
      spec.tests = spec.tests.filter((test: any) => test.projectName !== 'mobile-webkit');
    });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing file', async () => {
    const dir = await control();
    edit05(dir, (report) => {
      report.suites = report.suites.filter((suite: any) => !suite.specs.some((spec: any) => spec.file === 'lobby.spec.ts'));
    });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing report', async () => {
    const dir = await control();
    rmSync(reportPath(dir, '04-test-local-db'));
    expect(check(dir).ok).toBe(false);
  });

  it('fails a plan without required', async () => {
    const without: any = { ...plan, suite: plan.suite.map((step) => (step.id === '04-test-local-db' ? { ...step, required: undefined } : step)) };
    const dir = await control(without);
    expect(check(dir).ok).toBe(false);
  });
});
