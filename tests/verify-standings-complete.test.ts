import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkReloadEvidence, checkReplay } from '../.claude/skills/verify-build-a-bucket/scripts/replay-check.mjs';
import { buildControlFixture } from '../.claude/skills/verify-build-a-bucket/scripts/replay-records.mjs';
import { awaitReloadProof, compareStandings, completeStandings, refreshCoverage, reloadRecord, revisionLabel } from '../.claude/skills/verify-build-a-bucket/scripts/standings-check.mjs';
import { conference, fullTables } from './standings-rows';

const saved = JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/r39-rows-e70e204/saved-proof.json'), 'utf8'));
const revision = { stage: 'FIRST ROUND', progress: 'Game 1 next' };
const seats = [{ seat: 1, name: 'Ava' }, { seat: 2, name: 'Ben' }];
const refreshed = seats[1]!;
const pair = (tables: unknown[]) => tables.map((value, index) => ({ seat: seats[index]!, revision, tables: value as string[][] }));
const same = (value: unknown) => pair([value, value]);
const files = (seatsCaptured: { seat: number; name: string }[]) => new Map(seatsCaptured.flatMap(({ seat, name }) => ['before', 'after'].flatMap((phase) => ['.png', '.aria.txt'].map((suffix) => [`reload-${phase}-${seat}-${name}${suffix}`, 10] as [string, number]))));

async function proofFor(reads: ReturnType<typeof pair>) {
  const proof = await awaitReloadProof({ readAll: async () => reads, isRecap: async () => false, refreshedSeat: refreshed, wait: async () => {}, attempts: 3, navigation: { observed: true }, session: { present: true } });
  const reload = { ...proof, ran: true, refreshedSeat: refreshed, navigation: { observed: true }, session: { present: true }, attempts: 'reload-attempts.json' };
  const attempts = { classification: proof.classification, reason: proof.reason ?? null, revision: proof.revision, seats: proof.seats, rowsCompared: proof.rowsCompared, samples: proof.attempts };
  return { proof, reload, attempts };
}

function forgedComplete(rows: number) {
  const seatsLabel = ['1:Ava', '2:Ben'];
  const reload = { classification: 'stable-match', ran: true, revision, seats: seatsLabel, rowsCompared: rows, refreshedSeat: refreshed, navigation: { observed: true }, session: { present: true }, attempts: 'reload-attempts.json' };
  const attempts = { classification: 'stable-match', reason: null, revision, seats: seatsLabel, rowsCompared: rows, samples: [{ attempt: 0, ms: 0, recap: false, seats: seats.map((seat) => ({ ...seat, revision: revisionLabel(revision), rows })) }] };
  return { reload, attempts };
}

const shortCases: [string, unknown][] = [
  ['identical 9+9 rows', fullTables([9, 9])],
  ['10+9 rows', fullTables([10, 9])],
  ['9+10 rows', fullTables([9, 10])],
  ['one complete conference', [conference('E')]],
  ['a missing second conference', [conference('E'), []]],
  ['no conferences', []],
  ['three conferences', [conference('E'), conference('W'), conference('C')]],
  ['a non-array conference', [conference('E'), null]],
];

describe('incomplete standings earn no refresh credit', () => {
  it.each(shortCases)('compareStandings rejects matching %s', (_, tables) => {
    const result = compareStandings(same(tables), refreshed);
    expect(result.ok).toBe(false);
    expect(result.rowsCompared).toBeUndefined();
  });

  it.each(shortCases)('awaitReloadProof never classifies matching %s as stable-match', async (_, tables) => {
    const { proof } = await proofFor(same(tables));
    expect(proof.classification).not.toBe('stable-match');
    expect(proof.rowsCompared).toBe(0);
  });

  it('classifies identical 9+9 rows as invalid-display at the first read', async () => {
    const { proof } = await proofFor(same(fullTables([9, 9])));
    expect(proof.classification).toBe('invalid-display');
    expect(proof.reason).toBe('incomplete standings at revision FIRST ROUND:Game 1 next');
    expect(proof.attempts).toHaveLength(1);
  });

  it('rejects a complete seat paired with a matching shortened seat', () => {
    const [east, west] = fullTables();
    const result = compareStandings(pair([[east, west], [east, west!.slice(0, 9)]]), refreshed);
    expect(result).toEqual({ ok: false, reason: 'incomplete standings at revision FIRST ROUND:Game 1 next' });
  });

  it('carries the 9+9 probe through coverage and saved-evidence checks without credit', async () => {
    const { reload, attempts } = await proofFor(same(fullTables([9, 9])));
    expect(refreshCoverage(true, reload).ok).toBe(false);
    expect(reloadRecord(true, reload).coverage).toBe('reload classification is invalid-display');
    expect(checkReloadEvidence({ reload, attempts, files: files(seats), players: 2, reloadSeat: 2 })).toContain("reload attempts classification is 'invalid-display'");
  });

  it.each([0, 9, 10, 18, 19, 21, 22, 40])('refreshCoverage rejects a stable-match recording %i rows', (rows) => {
    expect(refreshCoverage(true, forgedComplete(rows).reload).ok).toBe(false);
  });

  it.each([18, 19, 21])('checkReloadEvidence rejects a saved stable-match with %i rows', (rows) => {
    const { reload, attempts } = forgedComplete(rows);
    const failures = checkReloadEvidence({ reload, attempts, files: files(seats), players: 2, reloadSeat: 2 });
    expect(failures).toContain(`reload.rowsCompared ${rows} != 20`);
  });

  it('checkReloadEvidence rejects a last sample showing fewer rows than the twenty compared', () => {
    const { reload, attempts } = forgedComplete(20);
    attempts.samples[0]!.seats[1]!.rows = 18;
    expect(checkReloadEvidence({ reload, attempts, files: files(seats), players: 2, reloadSeat: 2 })).toEqual(['reload last sample seat 2 shows 18 rows, fewer than 20']);
  });

  it('checkReloadEvidence rejects attempts that disagree with the summary row count', () => {
    const { reload, attempts } = forgedComplete(20);
    attempts.rowsCompared = 18;
    expect(checkReloadEvidence({ reload, attempts, files: files(seats), players: 2, reloadSeat: 2 })).toContain('reload attempts rowsCompared mismatch');
  });

  it('completeStandings accepts only two ten-row nonblank conferences', () => {
    expect(completeStandings(fullTables())).toBe(true);
    expect(completeStandings(fullTables([9, 9]))).toBe(false);
    expect(completeStandings(fullTables([10, 11]))).toBe(false);
    expect(completeStandings([conference('E')])).toBe(false);
    expect(completeStandings([conference('E'), conference('W'), conference('C')])).toBe(false);
    expect(completeStandings([conference('E'), null])).toBe(false);
    expect(completeStandings([conference('E'), [...conference('W', 9), ' ']])).toBe(false);
  });
});

describe('complete canonical conferences', () => {
  it('compares all 20 rows and excludes appended own-team rows', () => {
    const [east, west] = fullTables();
    const result = compareStandings(pair([[east, [...west!, '14 SAC Ben 30-52 31']], [[...east!, '12 MIL Ava 33-49 27'], west]]), refreshed);
    expect(result.ok).toBe(true);
    expect(result.rowsCompared).toBe(20);
    expect(result.standings).toEqual([east, west]);
  });

  it.each([[0, 9], [1, 9], [0, 0], [1, 0]])('fails a disagreement only in conference %i row %i', (table, row) => {
    const [east, west] = fullTables();
    const other = [[...east!], [...west!]];
    other[table]![row] = `${row + 1} XXX Other 1-81 59`;
    const result = compareStandings(pair([[east, west], other]), refreshed);
    expect(result).toEqual({ ok: false, reason: 'standings differ at revision FIRST ROUND:Game 1 next' });
  });

  it('classifies a last-row disagreement as unequal', async () => {
    const [east, west] = fullTables();
    const { proof } = await proofFor(pair([[east, west], [east, [...west!.slice(0, 9), '10 XXX Other 1-81 59']]]));
    expect(proof.classification).toBe('unequal');
  });

  it('accepts a complete stable-match end to end', async () => {
    const { proof, reload, attempts } = await proofFor(same(fullTables()));
    expect(proof.classification).toBe('stable-match');
    expect(proof.rowsCompared).toBe(20);
    expect(refreshCoverage(true, reload)).toEqual({ ok: true, reason: null });
    expect(checkReloadEvidence({ reload, attempts, files: files(seats), players: 2, reloadSeat: 2 })).toEqual([]);
  });
});

describe('saved e70e204 complete proof (squad-4p-reload2-07)', () => {
  const tables = saved.afterReload.standings;
  const readsFor = (value: (number: number) => unknown) => saved.reload.seats.map((label: string) => {
    const [seat, name] = label.split(':');
    return { seat: { seat: Number(seat), name }, revision: saved.reload.revision, tables: value(Number(seat)) };
  });

  it('still passes coverage and saved-evidence checks', () => {
    expect(completeStandings(tables)).toBe(true);
    expect(refreshCoverage(true, saved.reload)).toEqual({ ok: true, reason: null });
    expect(checkReloadEvidence({ reload: saved.reload, attempts: saved.attempts, files: new Map(Object.entries(saved.files)), players: saved.players, reloadSeat: saved.reloadSeat })).toEqual([]);
  });

  it('re-compares the saved rows across every seat as 20 rows', () => {
    const result = compareStandings(readsFor(() => tables), saved.reload.refreshedSeat);
    expect(result.ok).toBe(true);
    expect(result.rowsCompared).toBe(20);
    expect(result.seats).toEqual(saved.reload.seats);
  });

  it('fails when one seat disagrees in the last saved row', () => {
    const changed = [tables[0], [...tables[1].slice(0, 9), '10 GSW 38-44 23']];
    const result = compareStandings(readsFor((seat) => (seat === 3 ? changed : tables)), saved.reload.refreshedSeat);
    expect(result.reason).toBe('standings differ at revision FIRST ROUND:Game 1 next');
  });

  it('fails when every seat loses the same last row of each conference', () => {
    const result = compareStandings(readsFor(() => tables.map((rows: string[]) => rows.slice(0, 9))), saved.reload.refreshedSeat);
    expect(result.reason).toBe('incomplete standings at revision FIRST ROUND:Game 1 next');
  });

  it.each([
    ['summary and attempts both 18', (reload: Record<string, unknown>, attempts: Record<string, unknown>) => { reload.rowsCompared = 18; attempts.rowsCompared = 18; }, 'reload.rowsCompared 18 != 20'],
    ['attempts 18', (_: Record<string, unknown>, attempts: Record<string, unknown>) => { attempts.rowsCompared = 18; }, 'reload attempts rowsCompared mismatch'],
    ['the refreshed seat last sample 19', (_: Record<string, unknown>, attempts: { samples: { seats: { seat: number; rows: number }[] }[] }) => { attempts.samples.at(-1)!.seats.find((seat) => seat.seat === 2)!.rows = 19; }, 'reload last sample seat 2 shows 19 rows, fewer than 20'],
  ] as const)('fails contradictory saved row counts: %s', (_, edit, failure) => {
    const reload = structuredClone(saved.reload);
    const attempts = structuredClone(saved.attempts);
    edit(reload, attempts);
    expect(checkReloadEvidence({ reload, attempts, files: new Map(Object.entries(saved.files)), players: saved.players, reloadSeat: saved.reloadSeat })).toContain(failure);
  });
});

describe('replay checker row completeness', () => {
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
  const summaryFile = (dir: string) => path.join(dir, 'runs', 'run-a', 'evidence', 'league-2026-01-01T00-00-00-000Z-abc', 'summary.json');

  async function edited(edit: (summary: { reload: { rowsCompared: number }; stages: { label: string; standings?: string[][] }[] }, attemptsFile: string) => void) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'r39-rows-'));
    temps.push(dir);
    await buildControlFixture({ out: dir, plan, head });
    const file = summaryFile(dir);
    const summary = JSON.parse(readFileSync(file, 'utf8'));
    edit(summary, path.join(path.dirname(file), 'reload-attempts.json'));
    writeFileSync(file, JSON.stringify(summary, null, 2));
    const result = checkReplay({ out: dir, planPath: path.join(dir, 'plan.json'), expectedHead: head, cleanup: true });
    return { failures: result.rows.find((row: { name: string }) => row.name === 'run-a')!.failures as string[], refreshProofs: result.refreshProofs, ok: result.ok };
  }

  it('passes the complete writer-shaped control', async () => {
    expect(await edited(() => {})).toEqual({ failures: [], refreshProofs: 12, ok: true });
  });

  it('fails a shortened after-reload table whose row count matches the summary', async () => {
    const result = await edited((summary, attemptsFile) => {
      const after = summary.stages.find((stage) => stage.label === 'after-reload')!;
      after.standings = after.standings!.map((rows) => rows.slice(0, 9));
      summary.reload.rowsCompared = 18;
      const attempts = JSON.parse(readFileSync(attemptsFile, 'utf8'));
      attempts.rowsCompared = 18;
      writeFileSync(attemptsFile, JSON.stringify(attempts));
    });
    expect(result.failures).toEqual(expect.arrayContaining(['reload.rowsCompared is not 20', 'after-reload standings are not two complete ten-row conferences', 'reload.rowsCompared 18 != 20']));
    expect(result.refreshProofs).toBe(11);
    expect(result.ok).toBe(false);
  });

  it('fails a missing after-reload conference', async () => {
    const result = await edited((summary) => {
      const after = summary.stages.find((stage) => stage.label === 'after-reload')!;
      after.standings = [after.standings![0]!, []];
    });
    expect(result.failures).toEqual(expect.arrayContaining(['after-reload standings are not two complete ten-row conferences', 'after-reload rows 10 != rowsCompared 20']));
    expect(result.refreshProofs).toBe(11);
  });
});
