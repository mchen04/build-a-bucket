import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { allEliminated, assertRefreshCoverage, awaitReloadProof, compareStandings, createLeagueEvidenceDir, leagueFailureSummary, refreshCoverage, reloadRecord, shouldAwaitStandings } from '../.claude/skills/verify-build-a-bucket/scripts/standings-check.mjs';

function read(seat: number, revision: unknown, tables: string[][]) {
  return { seat: { seat, name: `S${seat}` }, revision, tables };
}

const rev = (stage: string, progress: string) => ({ stage, progress });
const proof = (overrides: Record<string, unknown> = {}) => ({ classification: 'stable-match', navigation: { observed: true }, session: { present: true }, attempts: 'attempts.json', ...overrides });
const rows = Array.from({ length: 20 }, (_, index) => [`${index + 1} T${index} P 60-22`]);
const reads = (revision: unknown, seats = [1, 2, 3]) => seats.map((seat) => read(seat, revision, rows));

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('standings comparison', () => {
  it('rejects differing season tables with em-dash seeds', () => {
    const result = compareStandings(
      [read(1, rev('Season', '100 / 1230'), [['— BOS Host 60-22 —']]), read(2, rev('Season', '100 / 1230'), [['— BOS Host 20-62 35']])],
      { seat: 2, name: 'S2' },
    );
    expect(result.ok).toBe(false);
  });

  it('rejects differing seeded tables', () => {
    const result = compareStandings(
      [read(1, rev('Season', '100 / 1230'), [['1 BOS Host 60-22 —']]), read(2, rev('Season', '100 / 1230'), [['1 BOS Host 20-62 35']])],
      { seat: 2, name: 'S2' },
    );
    expect(result.ok).toBe(false);
  });

  it('accepts identical full tables at the same revision', () => {
    const table = [['1 BOS Host 60-22 —', '2 NYK Away 55-27 5']];
    const result = compareStandings([read(1, rev('Season', '100 / 1230'), table), read(2, rev('Season', '100 / 1230'), table)], { seat: 2, name: 'S2' });
    expect(result.ok).toBe(true);
    expect(result.rowsCompared).toBe(2);
  });

  it('accepts differing own-team rows after the first ten', () => {
    const top = Array.from({ length: 10 }, (_, index) => `${index + 1} T${index} P ${60 - index}-2`);
    const result = compareStandings(
      [read(1, rev('Season', '100 / 1230'), [top.concat('15 SAC Ben 30-32')]), read(2, rev('Season', '100 / 1230'), [top.concat('15 MIL Ava 31-31')])],
      { seat: 2, name: 'S2' },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects empty tables', () => {
    expect(compareStandings([read(1, rev('Season', '1 / 10'), [[]]), read(2, rev('Season', '1 / 10'), [[]])], { seat: 2, name: 'S2' }).ok).toBe(false);
  });

  it('rejects one seat and a missing refreshed seat', () => {
    const table = [['1 BOS Host 60-22 —']];
    expect(compareStandings([read(1, rev('Season', '1 / 10'), table)], { seat: 1, name: 'S1' }).ok).toBe(false);
    expect(compareStandings([read(1, rev('Season', '1 / 10'), table), read(2, rev('Season', '1 / 10'), table)], { seat: 3, name: 'S3' }).ok).toBe(false);
  });
});

describe('reload proof boundary', () => {
  it('classifies a held-gate positive control as stable-match', async () => {
    const result = await awaitReloadProof({ readAll: async () => reads(rev('Playoffs', 'First Round')), isRecap: async () => false, refreshedSeat: { seat: 2, name: 'S2' }, wait: async () => {}, attempts: 3 });
    expect(result.classification).toBe('stable-match');
    expect(result.rowsCompared).toBe(20);
    expect(result.seats).toEqual(['1:S1', '2:S2', '3:S3']);
  });

  it('classifies a matching pair as stable-match', async () => {
    const result = await awaitReloadProof({ readAll: async () => reads(rev('Playoffs', 'First Round'), [1, 2]), isRecap: async () => false, refreshedSeat: { seat: 2, name: 'S2' }, wait: async () => {}, attempts: 3 });
    expect(result.classification).toBe('stable-match');
  });

  it('classifies differing tables at one revision as unequal', async () => {
    const result = await awaitReloadProof({
      readAll: async () => [read(1, rev('Playoffs', 'First Round'), rows), read(2, rev('Playoffs', 'First Round'), [['1 BOS Host 20-62 35']])],
      isRecap: async () => false,
      refreshedSeat: { seat: 2, name: 'S2' },
      wait: async () => {},
      attempts: 3,
    });
    expect(result.classification).toBe('unequal');
  });

  it('classifies recap at attempt 0 as recap-before-proof within one attempt', async () => {
    const result = await awaitReloadProof({
      readAll: async () => [read(1, rev('Playoffs', 'Conference Semifinals'), rows), read(2, rev('', ''), rows)],
      isRecap: async () => true,
      refreshedSeat: { seat: 2, name: 'S2' },
      wait: async () => {},
      attempts: 40,
    });
    expect(result.classification).toBe('recap-before-proof');
    expect(result.attempts).toHaveLength(1);
  });

  it('classifies a partial refreshed revision as invalid-display', async () => {
    const result = await awaitReloadProof({
      readAll: async () => [read(1, rev('Playoffs', 'First Round'), rows), read(2, rev('Playoffs', ''), rows)],
      isRecap: async () => false,
      refreshedSeat: { seat: 2, name: 'S2' },
      wait: async () => {},
      attempts: 3,
    });
    expect(result.classification).toBe('invalid-display');
  });

  it('classifies a refreshed seat absent from the matching group as no-common-revision', async () => {
    const result = await awaitReloadProof({
      readAll: async () => [read(1, rev('Playoffs', 'First Round'), rows), read(2, rev('Playoffs', 'Conference Semifinals'), rows)],
      isRecap: async () => false,
      refreshedSeat: { seat: 2, name: 'S2' },
      wait: async () => {},
      attempts: 3,
    });
    expect(result.classification).toBe('no-common-revision');
  });

  it('classifies no gate as no-held-boundary', async () => {
    const result = await awaitReloadProof({ gate: false, readAll: async () => [], isRecap: async () => true, refreshedSeat: { seat: 2, name: 'S2' }, wait: async () => {}, attempts: 1 });
    expect(result.classification).toBe('no-held-boundary');
  });

  it('records no-held-boundary even when the all-eliminated signature is absent', async () => {
    const result = await awaitReloadProof({ gate: false, readAll: async () => [], isRecap: async () => true, refreshedSeat: { seat: 2, name: 'S2' }, wait: async () => {}, attempts: 1 });
    expect(result.classification).toBe('no-held-boundary');
    expect(allEliminated({ out: [true, false], activity: ['The playoffs started automatically'] })).toBe(false);
  });

  it('classifies unobserved navigation as invalid-display', async () => {
    const result = await awaitReloadProof({ navigation: { observed: false, reason: 'marker survived' }, readAll: async () => reads(rev('Playoffs', 'First Round')), isRecap: async () => false, refreshedSeat: { seat: 2, name: 'S2' }, wait: async () => {}, attempts: 3 });
    expect(result.classification).toBe('invalid-display');
    expect(result.reason).toBe('marker survived');
  });

  it('fails a reload whose session did not persist', async () => {
    const result = await awaitReloadProof({ session: { present: false }, readAll: async () => reads(rev('Playoffs', 'First Round')), isRecap: async () => false, refreshedSeat: { seat: 2, name: 'S2' }, wait: async () => {}, attempts: 3 });
    expect(result.classification).toBe('invalid-display');
    expect(result.reason).toBe('session not persisted after reload');
  });

  it('awaits standings only when navigation and session both hold', () => {
    expect(shouldAwaitStandings({ navigation: { observed: true }, session: { present: true } })).toBe(true);
    expect(shouldAwaitStandings({ navigation: { observed: true }, session: { present: false } })).toBe(false);
    expect(shouldAwaitStandings({ navigation: { observed: true }, session: null })).toBe(false);
    expect(shouldAwaitStandings({ navigation: { observed: false }, session: { present: true } })).toBe(false);
    expect(shouldAwaitStandings({ navigation: null, session: { present: true } })).toBe(false);
  });

  it('detects the all-eliminated signature', () => {
    expect(allEliminated({ out: [true, true], activity: ['The playoffs started automatically', 'The playoffs started automatically'] })).toBe(true);
    expect(allEliminated({ out: [true, false], activity: ['The playoffs started automatically', 'The playoffs started automatically'] })).toBe(false);
    expect(allEliminated({ out: [true, true], activity: ['The playoffs started automatically', 'Waiting'] })).toBe(false);
  });
});

describe('league evidence and refresh coverage', () => {
  it('creates a new evidence directory and refuses an existing one', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'standings-evidence-'));
    temps.push(root);
    const first = createLeagueEvidenceDir(root, '2026-01-01T00-00-00-000Z', 'a');
    const second = createLeagueEvidenceDir(root, '2026-01-01T00-00-01-000Z', 'b');
    expect(first).not.toBe(second);
    expect(() => createLeagueEvidenceDir(root, '2026-01-01T00-00-00-000Z', 'a')).toThrow();
  });

  it('requires a recorded refresh comparison when --reload is set', () => {
    expect(() => assertRefreshCoverage(true, proof({ ran: false, revision: null, seats: [], rowsCompared: 0 }))).toThrow();
    expect(() => assertRefreshCoverage(true, proof({ ran: true, revision: rev('Season', '1 / 10'), seats: ['1:A', '2:B'], rowsCompared: 20, refreshedSeat: { seat: 2, name: 'B' } }))).not.toThrow();
  });

  it('records the coverage reason instead of throwing before the summary', () => {
    expect(reloadRecord(true, proof({ ran: false, revision: null, seats: [], rowsCompared: 0 }))).toEqual({
      classification: 'stable-match',
      navigation: { observed: true },
      session: { present: true },
      attempts: 'attempts.json',
      ran: false,
      revision: null,
      seats: [],
      rowsCompared: 0,
      coverage: 'reload did not run',
    });
    expect(reloadRecord(true, proof({ ran: true, revision: rev('Season', '1 / 10'), seats: ['1:A'], rowsCompared: 20 })).coverage).toBe('reload compared fewer than two distinct players');
    expect(reloadRecord(true, proof({ ran: true, revision: rev('Season', '1 / 10'), seats: ['1:A', '2:B'], rowsCompared: 0, refreshedSeat: { seat: 2, name: 'B' } })).coverage).toBe('reload compared no valid rows');
    expect(reloadRecord(true, proof({ ran: true, revision: rev('Season', '1 / 10'), seats: ['1:A', '2:B'], rowsCompared: 20, refreshedSeat: { seat: 2, name: 'B' } })).coverage).toBe('ok');
    expect(reloadRecord(false, proof({ ran: false, revision: null, seats: [], rowsCompared: 0 })).coverage).toBe('ok');
  });

  it('builds a failure summary that keeps the reload state', () => {
    const summary = leagueFailureSummary({
      error: new Error('no common standings revision after reload'),
      code: 'ABC123',
      players: 2,
      mode: 'normal',
      era: 'current',
      device: 'iphone',
      viewport: { width: 390, height: 844 },
      chaos: { reload: 2, away: null, hostLeave: false },
      reloadRequested: true,
      reload: proof({ ran: false, revision: null, seats: [], rowsCompared: 0 }),
      evidence: '/tmp/evidence/league-x',
      at: '2026-01-01T00:00:00.000Z',
    });
    expect(summary.ok).toBe(false);
    expect(summary.error).toContain('no common standings revision');
    expect(summary.reload.ran).toBe(false);
    expect(summary.reload.coverage).toBe('reload did not run');
    expect(summary.failedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('displayed revision validity (R21-A)', () => {
  const table = [['1 BOS Host 60-22 —', '2 NYK Away 55-27 5']];

  it('rejects a missing displayed revision even with identical full rows', () => {
    expect(compareStandings([read(1, ':', table), read(2, ':', table)], { seat: 2, name: 'S2' }).ok).toBe(false);
  });

  it('rejects a stage-only revision', () => {
    expect(compareStandings([read(1, 'Season:', table), read(2, 'Season:', table)], { seat: 2, name: 'S2' }).ok).toBe(false);
  });

  it('rejects a progress-only revision', () => {
    expect(compareStandings([read(1, ':1230', table), read(2, ':1230', table)], { seat: 2, name: 'S2' }).ok).toBe(false);
  });

  it('rejects an empty revision', () => {
    expect(compareStandings([read(1, '', table), read(2, '', table)], { seat: 2, name: 'S2' }).ok).toBe(false);
  });

  it('rejects recap-only reads with no displayed stage', () => {
    expect(compareStandings([read(1, rev('', ''), table), read(2, rev('', ''), table)], { seat: 2, name: 'S2' }).ok).toBe(false);
    expect(compareStandings([read(1, rev('', '1230'), table), read(2, rev('', '1230'), table)], { seat: 2, name: 'S2' }).ok).toBe(false);
  });

  it('accepts a valid structured revision for a regular-season table', () => {
    const result = compareStandings([read(1, rev('Season', '100 / 1230'), table), read(2, rev('Season', '100 / 1230'), table)], { seat: 2, name: 'S2' });
    expect(result.ok).toBe(true);
    expect(result.revision).toEqual({ stage: 'Season', progress: '100 / 1230' });
    expect(result.rowsCompared).toBe(2);
  });

  it('accepts a valid structured revision for a seeded table', () => {
    const seeded = [['1 BOS Host 60-22 —', '2 NYK Away 55-27 5']];
    const result = compareStandings([read(1, rev('Playoffs', 'First Round'), seeded), read(2, rev('Playoffs', 'First Round'), seeded)], { seat: 2, name: 'S2' });
    expect(result.ok).toBe(true);
    expect(result.revision).toEqual({ stage: 'Playoffs', progress: 'First Round' });
  });

  it('coverage rejects a legacy joined revision', () => {
    expect(() => assertRefreshCoverage(true, proof({ ran: true, revision: ':', seats: ['1:A', '2:B'], rowsCompared: 20 }))).toThrow();
    expect(() => assertRefreshCoverage(true, proof({ ran: true, revision: 'Season:', seats: ['1:A', '2:B'], rowsCompared: 20 }))).toThrow();
    expect(() => assertRefreshCoverage(true, proof({ ran: true, revision: ':1230', seats: ['1:A', '2:B'], rowsCompared: 20 }))).toThrow();
  });

  it('coverage rejects a partial structured revision', () => {
    expect(() => assertRefreshCoverage(true, proof({ ran: true, revision: rev('Season', ''), seats: ['1:A', '2:B'], rowsCompared: 20 }))).toThrow();
    expect(() => assertRefreshCoverage(true, proof({ ran: true, revision: rev('', '1230'), seats: ['1:A', '2:B'], rowsCompared: 20 }))).toThrow();
  });

  it('coverage accepts a valid structured revision', () => {
    expect(() => assertRefreshCoverage(true, proof({ ran: true, revision: rev('Season', '1 / 10'), seats: ['1:A', '2:B'], rowsCompared: 20, refreshedSeat: { seat: 2, name: 'B' } }))).not.toThrow();
  });
});

describe('numeric seat identity and real rows (R22)', () => {
  const table = [['1 BOS Host 60-22 —', '2 NYK Away 55-27 5']];
  const seat = (number: number, name: string) => ({ seat: number, name });

  it('rejects the same seat number under two names', () => {
    const result = compareStandings(
      [
        { seat: seat(2, 'Ben'), revision: rev('Season', '1 / 10'), tables: table },
        { seat: seat(2, 'Alias'), revision: rev('Season', '1 / 10'), tables: table },
      ],
      seat(2, 'Ben'),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects coverage for the same seat number under two names', () => {
    expect(refreshCoverage(true, proof({ ran: true, revision: rev('Season', '1 / 10'), seats: ['2:Ben', '2:Alias'], rowsCompared: 20, refreshedSeat: seat(2, 'Ben') })).ok).toBe(false);
  });

  it('rejects blank canonical rows', () => {
    const result = compareStandings(
      [
        { seat: seat(1, 'Ava'), revision: rev('Season', '1 / 10'), tables: [[' '], ['']] },
        { seat: seat(2, 'Ben'), revision: rev('Season', '1 / 10'), tables: [[' '], ['']] },
      ],
      seat(2, 'Ben'),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a non-positive row count in coverage', () => {
    expect(refreshCoverage(true, proof({ ran: true, revision: rev('Season', '1 / 10'), seats: ['1:Ava', '2:Ben'], rowsCompared: -1, refreshedSeat: seat(2, 'Ben') })).ok).toBe(false);
    expect(refreshCoverage(true, proof({ ran: true, revision: rev('Season', '1 / 10'), seats: ['1:Ava', '2:Ben'], rowsCompared: 0, refreshedSeat: seat(2, 'Ben') })).ok).toBe(false);
  });

  it('accepts two distinct numeric seats with real rows', () => {
    const result = compareStandings(
      [
        { seat: seat(1, 'Ava'), revision: rev('Season', '1 / 10'), tables: table },
        { seat: seat(2, 'Ben'), revision: rev('Season', '1 / 10'), tables: table },
      ],
      seat(2, 'Ben'),
    );
    expect(result.ok).toBe(true);
    expect(result.rowsCompared).toBe(2);
  });
});
