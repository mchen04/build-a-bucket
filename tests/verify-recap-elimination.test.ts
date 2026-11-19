import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRecapCapture, recapElimination } from '../.claude/skills/verify-build-a-bucket/scripts/standings-check.mjs';
import { classifyFixture, fixtureVerdict } from '../.claude/skills/verify-build-a-bucket/scripts/league-fixture.mjs';

const FIXTURES = path.join(process.cwd(), 'tests/fixtures/r39-elim-recap');
const NAMES = ['1-Ava', '2-Ben', '3-Cara', '4-Dev'];
type Capture = { seat: number; aria: string };
const pick = (captures: Capture[], index: number): Capture => {
  const capture = captures[index];
  if (!capture) throw new Error(`capture ${index} is missing`);
  return capture;
};
const real = (): Capture[] => NAMES.map((name, index) => ({ seat: index + 1, aria: readFileSync(path.join(FIXTURES, `${name}-recap.aria.txt`), 'utf8') }));
const saved = JSON.parse(readFileSync(path.join(FIXTURES, 'summary.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(path.join(process.cwd(), '.claude/skills/verify-build-a-bucket/fixtures/league-fixtures.json'), 'utf8'));
const elimEntry = catalog.entries.find((entry: { id: string }) => entry.id === 'squad-4p-elim');
const edit = (captures: { seat: number; aria: string }[], change: (aria: string, seat: number) => string) => captures.map((capture) => ({ ...capture, aria: change(capture.aria, capture.seat) }));
const loseFirstRound = (aria: string) => aria.replace(/4 P4( YOU)? Play-in exit · 40-42/, (_match, you) => `4 P4${you ?? ''} First round · 40-42`).replace('P4 40-42 CHA Play-in exit', 'P4 40-42 CHA First round');

describe('the saved fast-to-recap control', () => {
  it('reproduces the miss: the playoff-only sample left the row unknown', () => {
    expect(saved.reload.allEliminatedObserved).toBe(false);
    expect(saved.fixture.elimination).toBeNull();
    const recap = saved.marks.find((mark: { label: string }) => mark.label === 'recap').at;
    const rounds = saved.marks.filter((mark: { label: string }) => mark.label.startsWith('round:'));
    expect(rounds.length).toBeGreaterThan(0);
    expect(rounds.every((mark: { at: number }) => mark.at === recap)).toBe(true);
    expect(saved.stages.some((stage: { phase: string }) => stage.phase === 'Playoffs')).toBe(false);
    expect(classifyFixture({ gateSeen: false, gate: null, allEliminated: saved.reload.allEliminated, recap: true }).observedClass).toBe('unknown');
  });

  it('classifies all-eliminated from every seat recap', () => {
    const result = recapElimination({ players: 4, captures: real() });
    expect(result.reason).toBeNull();
    expect(result.allEliminated).toBe(true);
    expect(result.record?.seats.map((seat) => seat.finish)).toEqual(['Play-in exit', 'Missed playoffs', 'Missed playoffs', 'Play-in exit']);
    const classified = classifyFixture({ gateSeen: false, gate: null, allEliminated: result.allEliminated, recap: true });
    expect(classified.observedClass).toBe('all-eliminated');
    expect(fixtureVerdict({ entry: elimEntry, classified }).error).toBeNull();
  });

  it('accepts an agreeing live playoff sample', () => {
    const playoffSample = { seats: [1, 2, 3, 4].map((seat) => ({ seat, phase: 'Playoffs', rendered: true, out: true, autoStart: true })) };
    expect(recapElimination({ players: 4, captures: real(), playoffSample }).allEliminated).toBe(true);
  });

  it('parses each seat as its own view', () => {
    real().forEach((capture) => {
      const parsed = parseRecapCapture(capture.aria);
      expect(parsed?.seats.filter((row) => row.you).map((row) => row.seat)).toEqual([capture.seat]);
    });
  });
});

describe('recap elimination refuses', () => {
  const refuses = (captures: { seat: number; aria: string }[], options: { playoffSample?: { seats: { seat: number; phase: string; rendered: boolean; out: boolean; autoStart: boolean }[] } | null; gateSeen?: boolean; players?: number } = {}) => {
    const result = recapElimination({ players: options.players ?? 4, captures, playoffSample: options.playoffSample ?? null, gateSeen: options.gateSeen ?? false });
    expect(result.allEliminated).toBe(false);
    expect(result.record).toBeNull();
    return result.reason;
  };

  it('a later first-round loss', () => {
    expect(refuses(edit(real(), loseFirstRound))).toMatch(/seat 4 finished 'First round'/);
  });

  it('a computer champion without the seat table', () => {
    expect(refuses(edit(real(), (aria) => aria.replace(/SEAT PLAYER STATUS .* Your team/, 'Your team')))).toMatch(/malformed/);
  });

  it('a missing seat', () => {
    expect(refuses(real().slice(0, 3))).toMatch(/every planned seat/);
  });

  it('a duplicate seat', () => {
    const captures = real();
    captures[2] = { ...pick(captures, 1) };
    expect(refuses(captures)).toMatch(/missing, duplicate or unknown seat/);
  });

  it('a split recap', () => {
    const captures = real();
    captures[3] = { ...pick(captures, 3), aria: pick(captures, 3).aria.replace('3 P3 Missed playoffs · 22-60', '3 P3 Play-in exit · 22-60').replace('P3 22-60 BKN Missed playoffs', 'P3 22-60 BKN Play-in exit') };
    expect(refuses(captures)).toMatch(/disagrees with seat 1/);
  });

  it('another seat view under the wrong seat', () => {
    const captures = real();
    captures[2] = { seat: 3, aria: pick(captures, 1).aria };
    expect(refuses(captures)).toMatch(/seat 3 recap is not that seat's own view/);
  });

  it('a missing automatic start', () => {
    const captures = real();
    captures[1] = { ...pick(captures, 1), aria: pick(captures, 1).aria.replace('The playoffs started automatically ', '') };
    expect(refuses(captures)).toMatch(/plain automatic playoff start/);
  });

  it('an idle-wait start', () => {
    expect(refuses(edit(real(), (aria) => aria.replace('The playoffs started automatically', 'The playoffs started automatically after waiting for P2')))).toMatch(/plain automatic playoff start/);
  });

  it('a host start', () => {
    expect(refuses(edit(real(), (aria) => aria.replace('The playoffs started automatically', 'P1 started the playoffs')))).toMatch(/plain automatic playoff start/);
  });

  it('a held playoff gate', () => {
    expect(refuses(real(), { gateSeen: true })).toMatch(/held playoff gate/);
  });

  it('empty, missing and truncated captures', () => {
    const captures = real();
    expect(refuses(captures.map((capture, index) => (index === 0 ? { ...capture, aria: '' } : capture)))).toMatch(/seat 1 recap capture is malformed/);
    expect(refuses(captures.map((capture, index) => (index === 1 ? { seat: 2 } as unknown as { seat: number; aria: string } : capture)))).toMatch(/seat 2 recap capture is malformed/);
    expect(refuses(captures.map((capture, index) => (index === 2 ? { ...capture, aria: capture.aria.slice(0, capture.aria.indexOf(' Your team')) } : capture)))).toMatch(/seat 3 recap capture is malformed/);
  });

  it('a duplicated seat table', () => {
    const captures = real();
    captures[0] = { ...pick(captures, 0), aria: `${pick(captures, 0).aria}\n- text: "SEAT PLAYER STATUS 1 P1 Missed playoffs · 41-41 Your team"` };
    expect(refuses(captures)).toMatch(/seat 1 recap capture is malformed/);
  });

  it('unparsed text inside the seat table', () => {
    expect(refuses(edit(real(), (aria) => aria.replace(' · 35-47 3 P3', ' · 35-47 Eliminated early 3 P3')))).toMatch(/malformed/);
  });

  it('a seat listed twice in the table', () => {
    expect(refuses(edit(real(), (aria) => aria.replace(/ 4 P4( YOU)? Play-in exit · 40-42/, (match) => ` 3 P3 Missed playoffs · 22-60${match}`)))).toMatch(/does not list every seat once|disagrees/);
  });

  it('a live playoff sample with a seat not out', () => {
    expect(refuses(real(), { playoffSample: { seats: [1, 2, 3, 4].map((seat) => ({ seat, phase: 'Playoffs', rendered: true, out: seat !== 2, autoStart: true })) } })).toMatch(/live playoff sample/);
  });
});
