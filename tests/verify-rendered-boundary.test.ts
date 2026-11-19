import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gateReadiness, playoffSampleFrom, recapElimination, sampleReadComplete } from '../.claude/skills/verify-build-a-bucket/scripts/standings-check.mjs';
import { classifyFixture, fixtureVerdict } from '../.claude/skills/verify-build-a-bucket/scripts/league-fixture.mjs';

type Gate = { progress: string | null; ready: number; readyEnabled: number; start: number } | null;
type Read = { seat: number; phase: string; gate: Gate; next: boolean; log: boolean; out: boolean; activity: string };

const NAMES = ['1-Ava', '2-Ben', '3-Cara', '4-Dev'];
const GATE = path.join(process.cwd(), 'tests/fixtures/r39-gate-07');
const ELIM = path.join(process.cwd(), 'tests/fixtures/r39-elim-9975f2b');
const capture = (dir: string, name: string, label: string) => readFileSync(path.join(dir, `${name}-${label}.aria.txt`), 'utf8');
const count = (aria: string, pattern: RegExp) => (aria.match(pattern) ?? []).length;
const plainStart = (aria: string) => /The playoffs started automatically(?! after)/.test(aria.slice(aria.indexOf('League activity')));

function readFrom(seat: number, aria: string): Read {
  const progress = /\d+\/\d+ playoff teams ready/.exec(aria)?.[0] ?? null;
  return {
    seat,
    phase: /Lobby [A-Z0-9]{6} (.+?) SEAT PLAYER STATUS/.exec(aria)?.[1] ?? '',
    gate: progress ? { progress, ready: count(aria, /^- button "Ready"/gm), readyEnabled: count(aria, /^- button "Ready"$/gm), start: count(aria, /^- button "Start playoffs"/gm) } : null,
    next: true,
    log: aria.includes('League activity'),
    out: aria.includes('You are out'),
    activity: ['League activity', ...(plainStart(aria) ? ['The playoffs started automatically'] : [])].join('\n').toUpperCase(),
  };
}

const reads = (dir: string, labels: string[]) => NAMES.map((name, index) => readFrom(index + 1, capture(dir, name, labels[index] as string)));
const catalog = JSON.parse(readFileSync(path.join(process.cwd(), '.claude/skills/verify-build-a-bucket/fixtures/league-fixtures.json'), 'utf8'));
const entry = (id: string) => catalog.entries.find((candidate: { id: string }) => candidate.id === id);
const withGate = (list: Read[], seat: number, gate: Partial<NonNullable<Gate>> | null) => list.map((read) => (read.seat === seat ? { ...read, gate: gate === null ? null : { ...(read.gate as NonNullable<Gate>), ...gate } } : read));

describe('run squad-4p-reload2-07: the host saw the gate before the other seats', () => {
  const first = reads(GATE, ['stage-0', 'stage-0', 'stage-0', 'stage-0']);
  const held = reads(GATE, ['gate-1', 'gate-1', 'gate-1', 'gate-1']);

  it('replays the saved interleaving: host and Dev at the gate, Ben on Awards, Cara on Play-In', () => {
    expect(first.map((read) => read.phase)).toEqual(['Playoffs', 'Awards', 'Play-In', 'Playoffs']);
    expect(first[3]?.gate).toEqual({ progress: '0/1 playoff teams ready', ready: 0, readyEnabled: 0, start: 0 });
    expect(first[0]?.gate).toEqual({ progress: '0/1 playoff teams ready', ready: 0, readyEnabled: 0, start: 1 });
    expect(first.filter((read) => read.gate?.readyEnabled === 1).map((read) => read.seat)).toEqual([]);
    const verdict = gateReadiness({ players: 4, hostSeat: 1, reads: first });
    expect(verdict.coherent).toBe(false);
    expect(verdict.reason).toMatch(/seat 2 shows 'Awards'/);
    expect(classifyFixture({ gateSeen: true, gate: verdict, allEliminated: false, recap: true }).observedClass).toBe('unknown');
  });

  it('classifies the coherent held gate from every seat as Ben alone', () => {
    const verdict = gateReadiness({ players: 4, hostSeat: 1, reads: held });
    expect(verdict).toEqual({ coherent: true, reason: null, readySeats: [2], qualified: 1 });
    const classified = classifyFixture({ gateSeen: true, gate: verdict, allEliminated: false, recap: true });
    expect(fixtureVerdict({ entry: entry('squad-4p-q7'), classified }).error).toBeNull();
  });

  it('does not count the host Start playoffs control as Ready', () => {
    expect(held[0]?.gate).toEqual({ progress: '0/1 playoff teams ready', ready: 0, readyEnabled: 0, start: 1 });
    expect(gateReadiness({ players: 4, hostSeat: 1, reads: withGate(held, 2, { ready: 0, readyEnabled: 0 }) }).reason).toBe('0 actionable Ready controls for 1 playoff teams');
  });

  it('fails the wrong seat', () => {
    const moved = withGate(withGate(held, 2, { ready: 0, readyEnabled: 0 }), 3, { ready: 1, readyEnabled: 1 });
    const verdict = gateReadiness({ players: 4, hostSeat: 1, reads: moved });
    expect(verdict.readySeats).toEqual([3]);
    const classified = classifyFixture({ gateSeen: true, gate: verdict, allEliminated: false, recap: true });
    expect(fixtureVerdict({ entry: entry('squad-4p-q7'), classified }).error).toMatch(/observed seats \[3\], expected \[2\]/);
  });

  it.each([
    ['a missing seat', held.slice(0, 3), /every seat once/],
    ['a duplicate seat', [...held.slice(0, 3), { ...(held[2] as Read) }], /every seat once/],
    ['a stale seat', held.map((read) => (read.seat === 4 ? { ...read, phase: 'Play-In', gate: null } : read)), /seat 4 shows 'Play-In'/],
    ['a seat without the gate', withGate(held, 3, null), /seat 3 shows no held playoff gate/],
    ['a reconnecting seat', held.map((read) => (read.seat === 2 ? { ...read, phase: 'RECONNECTING' } : read)), /seat 2 shows 'RECONNECTING'/],
    ['contradictory progress', withGate(held, 3, { progress: '0/2 playoff teams ready' }), /different gate progress/],
    ['a gate already touched', held.map((read) => ({ ...read, gate: { ...(read.gate as NonNullable<Gate>), progress: '1/1 playoff teams ready' } })), /not an untouched held gate/],
    ['a disabled Ready', withGate(held, 2, { readyEnabled: 0 }), /seat 2 Ready control is not actionable/],
    ['two Ready controls for one team', withGate(held, 4, { ready: 1, readyEnabled: 1 }), /2 actionable Ready controls for 1/],
    ['a missing host Start', withGate(held, 1, { start: 0 }), /seat 1 Start playoffs control is wrong/],
    ['a Start on another seat', withGate(held, 3, { start: 1 }), /seat 3 Start playoffs control is wrong/],
    ['malformed progress', held.map((read) => ({ ...read, gate: { ...(read.gate as NonNullable<Gate>), progress: 'ready' } })), /malformed/],
  ])('fails %s', (_label, list, reason) => {
    const verdict = gateReadiness({ players: 4, hostSeat: 1, reads: list as Read[] });
    expect(verdict.coherent).toBe(false);
    expect(verdict.reason).toMatch(reason);
    expect(classifyFixture({ gateSeen: true, gate: verdict, allEliminated: false, recap: true })).toEqual({ observedClass: 'unknown', qualifyingSeats: [] });
  });

  it('keeps the same-revision refresh proof and session from the saved run', () => {
    const saved = JSON.parse(readFileSync(path.join(GATE, 'summary-excerpt.json'), 'utf8'));
    expect(saved.reload).toEqual({ classification: 'stable-match', rowsCompared: 20, session: { present: true }, navigation: { observed: true, type: 'reload', marker: null } });
    expect(saved.fixture.qualifyingSeats).toEqual([]);
  });
});

describe('run squad-4p-elim-reload2: Dev reached Recap before the sample', () => {
  const recaps = () => NAMES.map((name, index) => ({ seat: index + 1, aria: capture(ELIM, name, 'recap') }));
  const interleaved = () => reads(ELIM, ['stage-0', 'stage-0', 'stage-0', 'stage-1']);
  const saved = JSON.parse(readFileSync(path.join(ELIM, 'summary-excerpt.json'), 'utf8'));

  it('replays the saved sample: Dev rendered neither its next action nor its log', () => {
    expect(saved.playoffSample).toEqual({ out: [true, true, true, false], autoStart: [true, true, true, false] });
    const before = readFrom(4, capture(ELIM, '4-Dev', 'stage-0'));
    const after = readFrom(4, capture(ELIM, '4-Dev', 'stage-1'));
    expect([before.phase, before.out, after.phase, after.out]).toEqual(['Playoffs', true, 'Recap', false]);
    expect(playoffSampleFrom({ reads: [after] }).seats[0]?.autoStart).toBe(true);
    const between = { seat: 4, phase: 'Playoffs', gate: null, next: false, log: false, out: false, activity: '' };
    const sample = playoffSampleFrom({ reads: [...interleaved().slice(0, 3), between] });
    expect(sample.seats.map((seat) => seat.out)).toEqual(saved.playoffSample.out);
    expect(sample.seats.map((seat) => seat.autoStart)).toEqual(saved.playoffSample.autoStart);
    expect(sampleReadComplete(between)).toBe(false);
    expect(recapElimination({ players: 4, captures: recaps(), playoffSample: sample }).reason).toBe('seat 4 live playoff sample is incomplete');
    expect(recapElimination({ players: 4, captures: recaps(), playoffSample: saved.playoffSample }).reason).toBe('the live playoff sample does not cover every seat once');
  });

  it('accepts a complete re-read of Dev in Recap', () => {
    expect(sampleReadComplete(interleaved()[3])).toBe(true);
    expect(recapElimination({ players: 4, captures: recaps(), playoffSample: playoffSampleFrom({ reads: interleaved() }) }).allEliminated).toBe(true);
  });

  it('classifies all-eliminated when the out-of-phase seat shows Recap', () => {
    const playoffSample = playoffSampleFrom({ reads: interleaved() });
    const result = recapElimination({ players: 4, captures: recaps(), playoffSample });
    expect(result.reason).toBeNull();
    expect(result.record?.seats.map((seat) => seat.finish)).toEqual(['Play-in exit', 'Missed playoffs', 'Missed playoffs', 'Play-in exit']);
    expect(result.record?.playoffSample).toEqual(playoffSample);
    const classified = classifyFixture({ gateSeen: false, gate: null, allEliminated: result.allEliminated, recap: true });
    expect(fixtureVerdict({ entry: entry('squad-4p-elim'), classified }).error).toBeNull();
    expect(classified.qualifyingSeats).toEqual([]);
  });

  it('still passes when every seat is sampled in Playoffs', () => {
    const playoffSample = playoffSampleFrom({ reads: reads(ELIM, ['stage-0', 'stage-0', 'stage-0', 'stage-0']) });
    expect(recapElimination({ players: 4, captures: recaps(), playoffSample }).allEliminated).toBe(true);
  });

  const refused = (list: Read[], gateSeen = false) => recapElimination({ players: 4, captures: recaps(), playoffSample: playoffSampleFrom({ reads: list }), gateSeen });

  it.each([
    ['a same-phase seat not out', (list: Read[]) => list.map((read) => (read.seat === 4 ? { ...read, phase: 'Playoffs', out: false } : read)), /contradicts/],
    ['a same-phase seat without the plain start', (list: Read[]) => list.map((read) => (read.seat === 2 ? { ...read, activity: 'LEAGUE ACTIVITY\nP1 STARTED THE PLAYOFFS' } : read)), /contradicts/],
    ['a seat with no rendered phase', (list: Read[]) => list.map((read) => (read.seat === 4 ? { ...read, phase: '' } : read)), /seat 4 live playoff sample shows no Playoffs or Recap phase/],
    ['a reconnecting seat', (list: Read[]) => list.map((read) => (read.seat === 4 ? { ...read, phase: 'RECONNECTING' } : read)), /seat 4 live playoff sample/],
    ['a Playoffs seat without its log', (list: Read[]) => list.map((read) => (read.seat === 1 ? { ...read, log: false, activity: '' } : read)), /seat 1 live playoff sample is incomplete/],
    ['a seat in another phase', (list: Read[]) => list.map((read) => (read.seat === 3 ? { ...read, phase: 'Play-In' } : read)), /seat 3 live playoff sample/],
    ['a missing seat', (list: Read[]) => list.slice(0, 3), /every seat once/],
    ['a duplicate seat', (list: Read[]) => [...list.slice(0, 3), { ...(list[0] as Read) }], /every seat once/],
  ])('fails %s', (_label, change, reason) => {
    const result = refused(change(interleaved()));
    expect(result.allEliminated).toBe(false);
    expect(result.reason).toMatch(reason);
  });

  it('fails a held gate even with a coherent sample', () => {
    expect(refused(interleaved(), true).reason).toBe('a held playoff gate was seen');
  });

  it('never earns refresh credit', () => {
    const playoffSample = playoffSampleFrom({ reads: interleaved() });
    const result = recapElimination({ players: 4, captures: recaps(), playoffSample });
    expect(classifyFixture({ gateSeen: false, gate: null, allEliminated: result.allEliminated, recap: true })).toEqual({ observedClass: 'all-eliminated', qualifyingSeats: [] });
    expect(saved.stages.map((stage: { phase: string }) => stage.phase)).toEqual(['Playoffs', 'Recap', 'Recap']);
  });
});
