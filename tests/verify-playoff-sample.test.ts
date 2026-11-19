import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { playoffSampleFrom, recapElimination } from '../.claude/skills/verify-build-a-bucket/scripts/standings-check.mjs';

const FIXTURES = path.join(process.cwd(), 'tests/fixtures/r39-elim-recap');
const NAMES = ['1-Ava', '2-Ben', '3-Cara', '4-Dev'];
const captures = () => NAMES.map((name, index) => ({ seat: index + 1, aria: readFileSync(path.join(FIXTURES, `${name}-recap.aria.txt`), 'utf8') }));
const renderedLog = readFileSync(path.join(FIXTURES, 'rendered-activity.txt'), 'utf8');
const rendered = (...lines: string[]) => ['League activity', ...lines, 'P1 finished 35-47 · #11'].join('\n').toUpperCase();
const four = (text: string) => [text, text, text, text];
const toReads = (out: boolean[], activity: string[]) => Array.from({ length: Math.min(out.length, activity.length) }, (_, index) => ({ seat: index + 1, phase: 'Playoffs', next: true, log: true, out: out[index], activity: activity[index] }));
const flags = (out: boolean[], activity: string[]) => playoffSampleFrom({ reads: toReads(out, activity) }).seats.map((seat) => seat.autoStart);
const sampled = (activity: string[], out = [true, true, true, true]) => recapElimination({ players: 4, captures: captures(), playoffSample: playoffSampleFrom({ reads: toReads(out, activity) }) });

describe('the live playoff sample read from the rendered activity log', () => {
  it('the saved capture is the uppercase multiline render', () => {
    expect(renderedLog.startsWith('LEAGUE ACTIVITY\n')).toBe(true);
    expect(renderedLog.split('\n').length).toBeGreaterThan(5);
    expect(renderedLog).toBe(renderedLog.toUpperCase());
  });

  it('reads the uppercase plain automatic start as corroboration', () => {
    const activity = four(rendered('The playoffs started automatically'));
    expect(flags([true, true, true, true], activity)).toEqual([true, true, true, true]);
    const result = sampled(activity);
    expect(result.reason).toBeNull();
    expect(result.allEliminated).toBe(true);
  });

  it('reads unstyled text the same way', () => {
    const plain = ['League activity', 'The playoffs started automatically'].join('\n');
    expect(flags([true], [plain])).toEqual([true]);
  });

  it('reads the start line in the saved render shape', () => {
    const activity = four(renderedLog.replace('LEAGUE ACTIVITY\n', 'LEAGUE ACTIVITY\nTHE PLAYOFFS STARTED AUTOMATICALLY\n'));
    expect(sampled(activity).allEliminated).toBe(true);
  });

  it('still classifies without a sample', () => {
    expect(recapElimination({ players: 4, captures: captures() }).allEliminated).toBe(true);
  });

  it('rejects a render without the start line', () => {
    expect(flags([true], [renderedLog])).toEqual([false]);
    expect(sampled(four(renderedLog)).reason).toMatch(/live playoff sample/);
  });

  it.each([
    ['idle wait', 'The playoffs started automatically after waiting for P2'],
    ['all ready', 'Everyone was ready, so the playoffs started'],
    ['host start', 'P1 started the playoffs'],
  ])('rejects a %s start', (_label, line) => {
    expect(flags([true], [rendered(line)])).toEqual([false]);
    expect(sampled(four(rendered(line))).allEliminated).toBe(false);
  });

  it('rejects a plain start beside a held start', () => {
    expect(flags([true], [rendered('The playoffs started automatically', 'P1 started the playoffs')])).toEqual([false]);
  });

  it('rejects the start text inside another line', () => {
    expect(flags([true], [rendered('P2 said the playoffs started automatically')])).toEqual([false]);
  });

  it('rejects one seat without the start', () => {
    const ok = rendered('The playoffs started automatically');
    expect(sampled([ok, ok, ok, renderedLog]).allEliminated).toBe(false);
  });

  it('rejects a seat that is not out', () => {
    expect(sampled(four(rendered('The playoffs started automatically')), [true, false, true, true]).reason).toMatch(/live playoff sample/);
  });

  it('rejects a missing seat or empty log', () => {
    const ok = rendered('The playoffs started automatically');
    expect(sampled([ok, ok, ok]).allEliminated).toBe(false);
    expect(sampled([ok, ok, ok, '']).allEliminated).toBe(false);
    expect(sampled(four(ok), [true, true, true]).allEliminated).toBe(false);
  });
});
