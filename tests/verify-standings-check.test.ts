import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertRefreshCoverage, compareStandings, createLeagueEvidenceDir, leagueFailureSummary, reloadRecord } from '../.claude/skills/verify-build-a-bucket/scripts/standings-check.mjs';

function read(seat, revision, tables) {
  return { seat: { seat, name: `S${seat}` }, revision, tables };
}

const rev = (stage, progress) => ({ stage, progress });

const temps = [];
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
    const rows = [['1 BOS Host 60-22 —', '2 NYK Away 55-27 5']];
    const result = compareStandings([read(1, rev('Season', '100 / 1230'), rows), read(2, rev('Season', '100 / 1230'), rows)], { seat: 2, name: 'S2' });
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
    const rows = [['1 BOS Host 60-22 —']];
    expect(compareStandings([read(1, rev('Season', '1 / 10'), rows)], { seat: 1, name: 'S1' }).ok).toBe(false);
    expect(compareStandings([read(1, rev('Season', '1 / 10'), rows), read(2, rev('Season', '1 / 10'), rows)], { seat: 3, name: 'S3' }).ok).toBe(false);
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
    expect(() => assertRefreshCoverage(true, { ran: false, revision: null, seats: [], rowsCompared: 0 })).toThrow();
    expect(() => assertRefreshCoverage(true, { ran: true, revision: rev('Season', '1 / 10'), seats: ['1:A', '2:B'], rowsCompared: 20, refreshedSeat: { seat: 2, name: 'B' } })).not.toThrow();
  });

  it('records the coverage reason instead of throwing before the summary', () => {
    expect(reloadRecord(true, { ran: false, revision: null, seats: [], rowsCompared: 0 })).toEqual({
      ran: false,
      revision: null,
      seats: [],
      rowsCompared: 0,
      coverage: 'reload did not run',
    });
    expect(reloadRecord(true, { ran: true, revision: rev('Season', '1 / 10'), seats: ['1:A'], rowsCompared: 20 }).coverage).toBe('reload compared fewer than two distinct players');
    expect(reloadRecord(true, { ran: true, revision: rev('Season', '1 / 10'), seats: ['1:A', '2:B'], rowsCompared: 0, refreshedSeat: { seat: 2, name: 'B' } }).coverage).toBe('reload compared zero rows');
    expect(reloadRecord(true, { ran: true, revision: rev('Season', '1 / 10'), seats: ['1:A', '2:B'], rowsCompared: 20, refreshedSeat: { seat: 2, name: 'B' } }).coverage).toBe('ok');
    expect(reloadRecord(false, { ran: false, revision: null, seats: [], rowsCompared: 0 }).coverage).toBe('ok');
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
      reload: { ran: false, revision: null, seats: [], rowsCompared: 0 },
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
  const rows = [['1 BOS Host 60-22 —', '2 NYK Away 55-27 5']];

  it('rejects a missing displayed revision even with identical full rows', () => {
    expect(compareStandings([read(1, ':', rows), read(2, ':', rows)], { seat: 2, name: 'S2' }).ok).toBe(false);
  });

  it('rejects a stage-only revision', () => {
    expect(compareStandings([read(1, 'Season:', rows), read(2, 'Season:', rows)], { seat: 2, name: 'S2' }).ok).toBe(false);
  });

  it('rejects a progress-only revision', () => {
    expect(compareStandings([read(1, ':1230', rows), read(2, ':1230', rows)], { seat: 2, name: 'S2' }).ok).toBe(false);
  });

  it('rejects an empty revision', () => {
    expect(compareStandings([read(1, '', rows), read(2, '', rows)], { seat: 2, name: 'S2' }).ok).toBe(false);
  });

  it('rejects recap-only reads with no displayed stage', () => {
    expect(compareStandings([read(1, rev('', ''), rows), read(2, rev('', ''), rows)], { seat: 2, name: 'S2' }).ok).toBe(false);
    expect(compareStandings([read(1, rev('', '1230'), rows), read(2, rev('', '1230'), rows)], { seat: 2, name: 'S2' }).ok).toBe(false);
  });

  it('accepts a valid structured revision for a regular-season table', () => {
    const result = compareStandings([read(1, rev('Season', '100 / 1230'), rows), read(2, rev('Season', '100 / 1230'), rows)], { seat: 2, name: 'S2' });
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
    expect(() => assertRefreshCoverage(true, { ran: true, revision: ':', seats: ['1:A', '2:B'], rowsCompared: 20 })).toThrow();
    expect(() => assertRefreshCoverage(true, { ran: true, revision: 'Season:', seats: ['1:A', '2:B'], rowsCompared: 20 })).toThrow();
    expect(() => assertRefreshCoverage(true, { ran: true, revision: ':1230', seats: ['1:A', '2:B'], rowsCompared: 20 })).toThrow();
  });

  it('coverage rejects a partial structured revision', () => {
    expect(() => assertRefreshCoverage(true, { ran: true, revision: rev('Season', ''), seats: ['1:A', '2:B'], rowsCompared: 20 })).toThrow();
    expect(() => assertRefreshCoverage(true, { ran: true, revision: rev('', '1230'), seats: ['1:A', '2:B'], rowsCompared: 20 })).toThrow();
  });

  it('coverage accepts a valid structured revision', () => {
    expect(() => assertRefreshCoverage(true, { ran: true, revision: rev('Season', '1 / 10'), seats: ['1:A', '2:B'], rowsCompared: 20, refreshedSeat: { seat: 2, name: 'B' } })).not.toThrow();
  });
});
