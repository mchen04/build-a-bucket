import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertRefreshCoverage, compareStandings, createLeagueEvidenceDir } from '../.claude/skills/verify-build-a-bucket/scripts/standings-check.mjs';

function read(seat, revision, tables) {
  return { seat: { seat, name: `S${seat}` }, revision, tables };
}

const temps = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('standings comparison', () => {
  it('rejects differing season tables with em-dash seeds', () => {
    const result = compareStandings(
      [read(1, 'Season:100 / 1230', [['— BOS Host 60-22 —']]), read(2, 'Season:100 / 1230', [['— BOS Host 20-62 35']])],
      { seat: 2, name: 'S2' },
    );
    expect(result.ok).toBe(false);
  });

  it('rejects differing seeded tables', () => {
    const result = compareStandings(
      [read(1, 'Season:100 / 1230', [['1 BOS Host 60-22 —']]), read(2, 'Season:100 / 1230', [['1 BOS Host 20-62 35']])],
      { seat: 2, name: 'S2' },
    );
    expect(result.ok).toBe(false);
  });

  it('accepts identical full tables at the same revision', () => {
    const rows = [['1 BOS Host 60-22 —', '2 NYK Away 55-27 5']];
    const result = compareStandings([read(1, 'Season:100 / 1230', rows), read(2, 'Season:100 / 1230', rows)], { seat: 2, name: 'S2' });
    expect(result.ok).toBe(true);
    expect(result.rowsCompared).toBe(2);
  });

  it('accepts differing own-team rows after the first ten', () => {
    const top = Array.from({ length: 10 }, (_, index) => `${index + 1} T${index} P ${60 - index}-2`);
    const result = compareStandings(
      [read(1, 'Season:100 / 1230', [top.concat('15 SAC Ben 30-32')]), read(2, 'Season:100 / 1230', [top.concat('15 MIL Ava 31-31')])],
      { seat: 2, name: 'S2' },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects empty tables', () => {
    expect(compareStandings([read(1, 'Season:1 / 10', [[]]), read(2, 'Season:1 / 10', [[]])], { seat: 2, name: 'S2' }).ok).toBe(false);
  });

  it('rejects one seat and a missing refreshed seat', () => {
    const rows = [['1 BOS Host 60-22 —']];
    expect(compareStandings([read(1, 'Season:1 / 10', rows)], { seat: 1, name: 'S1' }).ok).toBe(false);
    expect(compareStandings([read(1, 'Season:1 / 10', rows), read(2, 'Season:1 / 10', rows)], { seat: 3, name: 'S3' }).ok).toBe(false);
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
    expect(() => assertRefreshCoverage(true, { ran: true, revision: 'Season:1 / 10', seats: ['1:A', '2:B'], rowsCompared: 20 })).not.toThrow();
  });
});
