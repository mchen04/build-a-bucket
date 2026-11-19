import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkReplay } from '../.claude/skills/verify-build-a-bucket/scripts/replay-check.mjs';
import { buildCleanupLines, buildControlFixture, selectRunDir } from '../.claude/skills/verify-build-a-bucket/scripts/replay-records.mjs';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const qualifying = (name: string, fixture: string) => ({ name, players: 2, mode: 'normal', device: 'iphone', reloadSeat: 2, awaySeat: null, hostLeave: false, fixture, expectedClass: 'qualifying', args: ['--reload', '2', '--fixture', fixture] });
const plan = {
  suite: [{ id: '01-typecheck', command: ['npm', 'run', 'typecheck'] }],
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

function control() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'r23-'));
  temps.push(dir);
  buildControlFixture({ out: dir, plan, head });
  return dir;
}

function check(dir: string, options: { expectedHead?: string | null; cleanup?: boolean } = {}) {
  return checkReplay({ out: dir, planPath: path.join(dir, 'plan.json'), expectedHead: options.expectedHead ?? head, cleanup: options.cleanup ?? true });
}

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const write = (file: string, value: unknown) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
};
const summaryPath = (dir: string, run: string) => path.join(dir, 'runs', run, 'evidence', 'league-2026-01-01T00-00-00-000Z-abc', 'summary.json');
const cleanupPath = (dir: string) => path.join(dir, 'cleanup-check.txt');
const editCleanup = (dir: string, edit: (lines: string[]) => string[]) => writeFileSync(cleanupPath(dir), edit(readFileSync(cleanupPath(dir), 'utf8').split('\n')).join('\n'));

describe('replay checker', () => {
  it('writes unknown for a cleanup inspection error', () => {
    const lines = buildCleanupLines({
      pid: 123,
      pgPort: 55434,
      e2ePort: 4392,
      suitePgPort: 55435,
      probes: { pid: 'error', port: 'absent', pgPort: 'absent', e2ePort: 'absent', suitePgPort: 'absent' },
    });
    expect(lines).toContain('pid_alive=unknown');
  });

  it('passes the writer-shaped control', () => {
    const result = check(control());
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails a missing planned run', () => {
    const dir = control();
    rmSync(path.join(dir, 'runs', 'run-b'), { recursive: true, force: true });
    expect(check(dir).ok).toBe(false);
  });

  it('fails an extra run', () => {
    const dir = control();
    write(path.join(dir, 'runs', 'run-d', 'run.json'), { label: 'run-d' });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing run.json', () => {
    const dir = control();
    rmSync(path.join(dir, 'runs', 'run-a', 'run.json'));
    expect(check(dir).ok).toBe(false);
  });

  it('fails a malformed run.json', () => {
    const dir = control();
    writeFileSync(path.join(dir, 'runs', 'run-a', 'run.json'), '{');
    expect(check(dir).ok).toBe(false);
  });

  it('fails run.json that disagrees with the plan', () => {
    const dir = control();
    const file = path.join(dir, 'runs', 'run-a', 'run.json');
    const value = read(file);
    value.device = 'pixel';
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a summary that contradicts the planned scenario', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.players = 1;
    value.mode = 'salary';
    value.device = 'pixel';
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails missing nested error arrays', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.errors = value.errors.map(({ seat, name }: { seat: number; name: string }) => ({ seat, name }));
    value.httpErrors = value.httpErrors.map(({ seat, name }: { seat: number; name: string }) => ({ seat, name }));
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails empty error lists', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.errors = [];
    value.httpErrors = [];
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing reload comparison', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.reload = { ran: false, revision: null, seats: [], rowsCompared: 0, refreshedSeat: null, coverage: 'reload did not run' };
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing refreshed seat', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    delete value.reload.refreshedSeat;
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a wrong refreshed seat', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.reload.refreshedSeat.seat = 1;
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a phantom reload seat', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.reload.seats = [...value.reload.seats, '999:Phantom'];
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a non-stable reload classification', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.reload.classification = 'unequal';
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails unobserved reload navigation', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.reload.navigation = { observed: false };
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing reload attempts file', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.reload.attempts = null;
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a malformed reload attempts file', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    writeFileSync(path.join(path.dirname(file), value.reload.attempts), '{');
    expect(check(dir).ok).toBe(false);
  });

  it('fails an absolute reload attempts path', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.reload.attempts = '/tmp/reload-attempts.json';
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a relative-escape reload attempts path', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.reload.attempts = '../reload-attempts.json';
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a differently named reload attempts path', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.reload.attempts = 'other.json';
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a reload attempts classification mismatch', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    const attempts = read(path.join(path.dirname(file), value.reload.attempts));
    attempts.classification = 'unequal';
    write(path.join(path.dirname(file), value.reload.attempts), attempts);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a reload attempts revision mismatch', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    const attempts = read(path.join(path.dirname(file), value.reload.attempts));
    attempts.revision = { stage: 'Season', progress: '2 / 10' };
    write(path.join(path.dirname(file), value.reload.attempts), attempts);
    expect(check(dir).ok).toBe(false);
  });

  it('fails an over-bound reload attempts file', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    const attempts = read(path.join(path.dirname(file), value.reload.attempts));
    attempts.samples = Array.from({ length: 61 }, () => ({}));
    write(path.join(path.dirname(file), value.reload.attempts), attempts);
    expect(check(dir).ok).toBe(false);
  });

  it('fails zero reload rows', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.reload.rowsCompared = 0;
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing after-reload stage', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.stages = value.stages.filter((stage: { label: string }) => stage.label !== 'after-reload');
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails an after-reload stage that contradicts the reload record', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.stages.find((stage: { label: string }) => stage.label === 'after-reload').revision = { stage: 'Season', progress: '2 / 10' };
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing away stage', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-b');
    const value = read(file);
    value.stages = value.stages.filter((stage: { label: string }) => stage.label !== 'away');
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing host-left stage', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-c');
    const value = read(file);
    value.stages = value.stages.filter((stage: { label: string }) => stage.label !== 'host-left');
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails an empty exit receipt', () => {
    const dir = control();
    writeFileSync(path.join(dir, 'runs', 'run-a', 'exit'), '');
    expect(check(dir).ok).toBe(false);
  });

  it('fails a nonzero exit receipt', () => {
    const dir = control();
    writeFileSync(path.join(dir, 'runs', 'run-a', 'exit'), '1\n');
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing suite receipt', () => {
    const dir = control();
    rmSync(path.join(dir, 'suite', '01-typecheck'), { recursive: true, force: true });
    expect(check(dir).ok).toBe(false);
  });

  it('fails a suite command that differs from the plan', () => {
    const dir = control();
    writeFileSync(path.join(dir, 'suite', '01-typecheck', 'command.txt'), 'true\n');
    expect(check(dir).ok).toBe(false);
  });

  it('fails an empty suite output log', () => {
    const dir = control();
    writeFileSync(path.join(dir, 'suite', '01-typecheck', 'output.log'), '');
    expect(check(dir).ok).toBe(false);
  });

  it('fails a nonzero suite receipt', () => {
    const dir = control();
    writeFileSync(path.join(dir, 'suite', '01-typecheck', 'exit'), '1\n');
    expect(check(dir).ok).toBe(false);
  });

  it('fails a candidate head mismatch', () => {
    const dir = control();
    const meta = read(path.join(dir, 'meta.json'));
    meta.head = 'def';
    write(path.join(dir, 'meta.json'), meta);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a launch record with a different head', () => {
    const dir = control();
    const launch = read(path.join(dir, 'launch.json'));
    launch.head = '67eb0d5';
    write(path.join(dir, 'launch.json'), launch);
    expect(check(dir).ok).toBe(false);
  });

  it('fails an empty launch head', () => {
    const dir = control();
    const launch = read(path.join(dir, 'launch.json'));
    launch.head = '';
    write(path.join(dir, 'launch.json'), launch);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a one-character launch head', () => {
    const dir = control();
    const launch = read(path.join(dir, 'launch.json'));
    launch.head = 'a';
    write(path.join(dir, 'launch.json'), launch);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a short meta head', () => {
    const dir = control();
    const meta = read(path.join(dir, 'meta.json'));
    meta.head = 'abc';
    write(path.join(dir, 'meta.json'), meta);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a nonzero launch exit', () => {
    const dir = control();
    writeFileSync(path.join(dir, 'launch.exit'), '1\n');
    expect(check(dir).ok).toBe(false);
  });

  it('fails a dropped Postgres port', () => {
    const dir = control();
    const tracked = read(path.join(dir, 'tracked.json'));
    delete tracked.pgPort;
    write(path.join(dir, 'tracked.json'), tracked);
    editCleanup(dir, (lines) => lines.filter((line) => !line.startsWith('pg_port_listening=')));
    expect(check(dir).ok).toBe(false);
  });

  it('fails missing cleanup tracking', () => {
    const dir = control();
    rmSync(path.join(dir, 'tracked.json'));
    expect(check(dir).ok).toBe(false);
  });

  it('fails an empty cleanup check file', () => {
    const dir = control();
    writeFileSync(cleanupPath(dir), '');
    expect(check(dir).ok).toBe(false);
  });

  it('fails a partial cleanup check file', () => {
    const dir = control();
    writeFileSync(cleanupPath(dir), 'pid_alive=no\n');
    expect(check(dir).ok).toBe(false);
  });

  it('fails duplicate cleanup lines', () => {
    const dir = control();
    editCleanup(dir, (lines) => ['pid=123', ...lines]);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a live cleanup result', () => {
    const dir = control();
    editCleanup(dir, (lines) => lines.map((line) => (line.startsWith('pid_alive=') ? 'pid_alive=yes' : line)));
    expect(check(dir).ok).toBe(false);
  });

  it('fails an inspection error', () => {
    const dir = control();
    editCleanup(dir, (lines) => lines.map((line) => (line.startsWith('pid_alive=') ? 'pid_alive=unknown' : line)));
    expect(check(dir).ok).toBe(false);
  });

  it('fails a listening suite port', () => {
    const dir = control();
    editCleanup(dir, (lines) => lines.map((line) => (line.startsWith('e2e_port_listening=') ? 'e2e_port_listening=yes' : line)));
    expect(check(dir).ok).toBe(false);
  });

  it('fails a missing suite Postgres port proof', () => {
    const dir = control();
    editCleanup(dir, (lines) => lines.filter((line) => !line.startsWith('suite_pg_port_listening=')));
    expect(check(dir).ok).toBe(false);
  });

  it('fails a nonzero cleanup exit', () => {
    const dir = control();
    writeFileSync(path.join(dir, 'cleanup.exit'), '1\n');
    expect(check(dir).ok).toBe(false);
  });

  it('passes the plan with 12 refresh proofs', () => {
    const result = check(control());
    expect(result.ok).toBe(true);
    expect(result.refreshProofs).toBe(12);
  });

  it('fails an all-eliminated row with a stable-match reload', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-elim');
    const value = read(file);
    value.reload = { ...value.reload, classification: 'stable-match', ran: true };
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('passes an all-eliminated row with no-held-boundary and keeps 12 proofs', () => {
    const result = check(control());
    expect(result.ok).toBe(true);
    expect(result.refreshProofs).toBe(12);
  });

  it('fails an all-eliminated row without a recap mark', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-elim');
    const value = read(file);
    value.marks = [];
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a wrong observedClass and drops to 11 proofs', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-q02');
    const value = read(file);
    value.fixture.observedClass = 'all-eliminated';
    write(file, value);
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(11);
  });

  it('fails a stable-match row without a persisted session', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-a');
    const value = read(file);
    value.reload.session = { present: false };
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  const attemptsPath = (dir: string) => path.join(path.dirname(summaryPath(dir, 'run-a')), 'reload-attempts.json');
  const editAttempts = (dir: string, edit: (value: any) => void) => { const file = attemptsPath(dir); const value = read(file); edit(value); write(file, value); };
  const capturePath = (dir: string, name: string) => path.join(path.dirname(summaryPath(dir, 'run-a')), name);

  it('fails empty samples', () => {
    const dir = control();
    editAttempts(dir, (value) => { value.samples = []; });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(11);
  });

  it('fails 61 samples', () => {
    const dir = control();
    editAttempts(dir, (value) => { value.samples = Array.from({ length: 61 }, (_, index) => ({ attempt: index, ms: index, recap: false, seats: [] })); });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(11);
  });

  it('fails a last sample recap', () => {
    const dir = control();
    editAttempts(dir, (value) => { value.samples[value.samples.length - 1].recap = true; });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(11);
  });

  it('fails a last-sample seat 99', () => {
    const dir = control();
    editAttempts(dir, (value) => { value.samples[value.samples.length - 1].seats.push({ seat: 99, name: 'P99', revision: 'Season: 1 / 10', rows: 20 }); });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(11);
  });

  it('fails a missing refreshed seat', () => {
    const dir = control();
    editAttempts(dir, (value) => { value.samples[value.samples.length - 1].seats = value.samples[value.samples.length - 1].seats.filter((seat: { seat: number }) => seat.seat !== 2); });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(11);
  });

  it('fails rows 0 for seat 1', () => {
    const dir = control();
    editAttempts(dir, (value) => { value.samples[value.samples.length - 1].seats.find((seat: { seat: number }) => seat.seat === 1).rows = 0; });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(11);
  });

  it('fails a last-sample revision', () => {
    const dir = control();
    editAttempts(dir, (value) => { value.samples[value.samples.length - 1].seats[0].revision = 'Season:2 / 10'; });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(11);
  });

  it('fails attempts seats', () => {
    const dir = control();
    editAttempts(dir, (value) => { value.seats = ['1:P1']; });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(11);
  });

  it('fails attempts classification', () => {
    const dir = control();
    editAttempts(dir, (value) => { value.classification = 'unequal'; });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(11);
  });

  it('fails non-sequential attempts', () => {
    const dir = control();
    editAttempts(dir, (value) => { value.samples[1].attempt = 2; });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(11);
  });

  it('fails a string ms', () => {
    const dir = control();
    editAttempts(dir, (value) => { value.samples[1].ms = '0'; });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(11);
  });

  it('fails a missing before png', () => {
    const dir = control();
    rmSync(capturePath(dir, 'reload-before-2-P2.png'));
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(11);
  });

  it('fails an empty after aria', () => {
    const dir = control();
    writeFileSync(capturePath(dir, 'reload-after-1-P1.aria.txt'), '');
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(11);
  });

  it('fails no other seat captures', () => {
    const dir = control();
    for (const name of ['reload-before-1-P1.png', 'reload-before-1-P1.aria.txt', 'reload-after-1-P1.png', 'reload-after-1-P1.aria.txt']) rmSync(capturePath(dir, name));
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(11);
  });

  it('passes the all-eliminated row', () => {
    const result = check(control());
    expect(result.ok).toBe(true);
    expect(result.refreshProofs).toBe(12);
  });

  const elimSummaryPath = (dir: string) => summaryPath(dir, 'run-elim');
  const elimAttemptsPath = (dir: string) => path.join(path.dirname(elimSummaryPath(dir)), 'reload-attempts.json');
  const editElimSummary = (dir: string, edit: (value: any) => void) => { const file = elimSummaryPath(dir); const value = read(file); edit(value); write(file, value); };
  const editElimAttempts = (dir: string, edit: (value: any) => void) => { const file = elimAttemptsPath(dir); const value = read(file); edit(value); write(file, value); };
  const elimCapturePath = (dir: string, name: string) => path.join(path.dirname(elimSummaryPath(dir)), name);

  it('fails a deleted all-eliminated attempts file', () => {
    const dir = control();
    rmSync(elimAttemptsPath(dir));
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(12);
  });

  it('fails an all-eliminated attempts classification', () => {
    const dir = control();
    editElimAttempts(dir, (value) => { value.classification = 'stable-match'; });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(12);
  });

  it('fails allEliminated false', () => {
    const dir = control();
    editElimSummary(dir, (value) => { value.reload.allEliminated = false; });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(12);
  });

  it('fails an elimination out false', () => {
    const dir = control();
    editElimSummary(dir, (value) => { value.fixture.elimination.out[0] = false; });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(12);
  });

  it('fails a short autoStart', () => {
    const dir = control();
    editElimSummary(dir, (value) => { value.fixture.elimination.autoStart.pop(); });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(12);
  });

  it('fails a null elimination', () => {
    const dir = control();
    editElimSummary(dir, (value) => { value.fixture.elimination = null; });
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(12);
  });

  it('fails a deleted none capture', () => {
    const dir = control();
    rmSync(elimCapturePath(dir, 'reload-none-2-P2.png'));
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(12);
  });

  it('fails an extra after capture', () => {
    const dir = control();
    writeFileSync(elimCapturePath(dir, 'reload-after-2-P2.png'), 'png');
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(12);
  });

  it('fails no other seat captures', () => {
    const dir = control();
    for (const name of ['reload-before-1-P1.png', 'reload-before-1-P1.aria.txt', 'reload-none-1-P1.png', 'reload-none-1-P1.aria.txt']) rmSync(elimCapturePath(dir, name));
    const result = check(dir);
    expect(result.ok).toBe(false);
    expect(result.refreshProofs).toBe(12);
  });

  it('fails a fixture row without summary.fixture', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-q02');
    const value = read(file);
    delete value.fixture;
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a non-fixture row with summary.fixture', () => {
    const dir = control();
    const file = summaryPath(dir, 'run-ui');
    const value = read(file);
    value.fixture = { id: 'fx-ui', expectedClass: 'qualifying', observedClass: 'qualifying', qualifyingSeats: [1] };
    write(file, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a plan fixture with null expectedClass', () => {
    const dir = control();
    const planFile = path.join(dir, 'plan.json');
    const value = read(planFile);
    value.runs.find((run: { name: string }) => run.name === 'run-q02').expectedClass = null;
    write(planFile, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a duplicate fixture id', () => {
    const dir = control();
    const planFile = path.join(dir, 'plan.json');
    const value = read(planFile);
    const run = value.runs.find((entry: { name: string }) => entry.name === 'run-q03');
    run.fixture = 'fx-02';
    run.args = ['--reload', '2', '--fixture', 'fx-02'];
    write(planFile, value);
    expect(check(dir).ok).toBe(false);
  });

  it('fails a plan without run-q12', () => {
    const dir = control();
    const planFile = path.join(dir, 'plan.json');
    const value = read(planFile);
    value.runs = value.runs.filter((run: { name: string }) => run.name !== 'run-q12');
    write(planFile, value);
    expect(check(dir).ok).toBe(false);
  });
});

describe('run dir selection', () => {
  it('selects the launched run dir from launch.json', () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'r26-'));
    temps.push(out);
    const run = path.join(out, 'bab-home', 'id');
    mkdirSync(run, { recursive: true });
    writeFileSync(path.join(out, 'launch.json'), JSON.stringify({ run }));
    expect(selectRunDir({ out, launchAttempted: true, verifyHome: path.join(out, 'bab-home') })).toBe(run);
  });

  it('falls back to current only inside the verify home', () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'r26-'));
    temps.push(out);
    const home = path.join(out, 'bab-home');
    const run = path.join(home, 'id');
    mkdirSync(run, { recursive: true });
    writeFileSync(path.join(home, 'current'), run);
    expect(selectRunDir({ out, launchAttempted: true, verifyHome: home })).toBe(run);
    writeFileSync(path.join(home, 'current'), '/tmp/other');
    expect(selectRunDir({ out, launchAttempted: true, verifyHome: home })).toBe('');
  });

  it('returns empty when no launch was attempted', () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'r26-'));
    temps.push(out);
    expect(selectRunDir({ out, launchAttempted: false, verifyHome: path.join(out, 'bab-home') })).toBe('');
  });
});
