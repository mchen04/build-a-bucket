import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareStandings, distinctSeatLabels, readLeagueStandings, refreshCoverage } from '../.claude/skills/verify-build-a-bucket/scripts/standings-check.mjs';

const rows = [
  Array.from({ length: 10 }, (_, index) => `${index + 1} T${index}A 5-5 0.0 Ava`),
  Array.from({ length: 10 }, (_, index) => `${index + 1} T${index}B 5-5 0.0 Ben`),
];

type FakeNode = { innerText: string; hidden: boolean; getClientRects: () => unknown[] };

function node(text: string, { hidden = false, rects = 1 }: { hidden?: boolean; rects?: number } = {}): FakeNode {
  return { innerText: text, hidden, getClientRects: () => Array.from({ length: rects }, () => ({})) };
}

function dom({
  stage,
  progress,
  status = 'Simulating',
  nextAction = 'Waiting for other teams',
  tables = rows,
}: { stage?: FakeNode; progress?: FakeNode; status?: string; nextAction?: string; tables?: string[][] } = {}) {
  const nodes = new Map();
  if (stage !== undefined) nodes.set('[data-testid="league-stage-name"]', stage);
  if (progress !== undefined) nodes.set('[data-testid="league-stage-progress"]', progress);
  nodes.set('[data-testid="league-stage-status"]', node(status));
  nodes.set('[data-testid="next-action"]', node(nextAction));
  return {
    querySelector: (selector: string) => nodes.get(selector) ?? null,
    querySelectorAll: (selector: string) =>
      selector === '[data-testid="standings"] .table'
        ? tables.map((table) => ({ querySelectorAll: () => table.map((text) => ({ innerText: text })) }))
        : [],
  };
}

function readWith(options: Parameters<typeof dom>[0]) {
  globalThis.document = dom(options) as unknown as Document;
  return readLeagueStandings();
}

const rev = (stage: string, progress: string) => ({ stage, progress });
const seat = (number: number, name: string) => ({ seat: number, name });

describe('league stage reader', () => {
  it('reads the stage and progress from their own elements', () => {
    const read = readWith({ stage: node('Regular Season'), progress: node('10 / 82') });
    expect(read.revision).toEqual(rev('Regular Season', '10 / 82'));
    expect(read.tables).toHaveLength(2);
  });

  it('does not slide status or next-action text into a missing progress field', () => {
    expect(readWith({ stage: node('Regular Season') }).revision).toEqual(rev('Regular Season', ''));
  });

  it('does not slide status or next-action text into a missing stage field', () => {
    expect(readWith({ progress: node('10 / 82') }).revision).toEqual(rev('', '10 / 82'));
  });

  it('returns empty fields when both elements are missing', () => {
    expect(readWith({}).revision).toEqual(rev('', ''));
  });

  it('treats blank and whitespace-only fields as empty', () => {
    expect(readWith({ stage: node('   '), progress: node('\n\t') }).revision).toEqual(rev('', ''));
  });

  it('treats hidden fields as empty', () => {
    expect(readWith({ stage: node('Regular Season', { hidden: true }), progress: node('10 / 82', { hidden: true }) }).revision).toEqual(rev('', ''));
    expect(readWith({ stage: node('Regular Season', { rects: 0 }), progress: node('10 / 82', { rects: 0 }) }).revision).toEqual(rev('', ''));
  });

  it('returns empty fields on recap with no stage card', () => {
    expect(readWith({ stage: undefined, progress: undefined }).revision).toEqual(rev('', ''));
  });

  it('reads a complete seeded stage', () => {
    expect(readWith({ stage: node('Playoffs'), progress: node('First Round') }).revision).toEqual(rev('Playoffs', 'First Round'));
  });

  it('rejects every incomplete read even with identical full rows', () => {
    const cases = [
      readWith({ stage: node('Regular Season') }),
      readWith({ progress: node('10 / 82') }),
      readWith({}),
      readWith({ stage: node('  '), progress: node('  ') }),
      readWith({ stage: node('Regular Season', { hidden: true }), progress: node('10 / 82') }),
    ];
    for (const read of cases) {
      const result = compareStandings([{ seat: seat(1, 'Ava'), ...read }, { seat: seat(2, 'Ben'), ...read }], seat(2, 'Ben'));
      expect(result.ok).toBe(false);
    }
  });

  it('accepts a complete read with identical full rows', () => {
    const read = readWith({ stage: node('Regular Season'), progress: node('10 / 82') });
    const result = compareStandings([{ seat: seat(1, 'Ava'), ...read }, { seat: seat(2, 'Ben'), ...read }], seat(2, 'Ben'));
    expect(result.ok).toBe(true);
    expect(result.rowsCompared).toBe(20);
  });

  it('uses the test ids rendered by LeaguePanel', () => {
    const source = readFileSync(new URL('../src/app/screens/LeaguePanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('data-testid="league-stage-name"');
    expect(source).toContain('data-testid="league-stage-progress"');
  });
});

describe('distinct players', () => {
  const read = (number: number, name: string) => ({ seat: seat(number, name), revision: rev('Season', '1 / 10'), tables: rows });

  it('counts distinct seat numbers and names', () => {
    expect(distinctSeatLabels(['1:Ava', '2:Ben', '2:Ben']).size).toBe(2);
    expect(distinctSeatLabels(['2:Ben', '2:Ben']).size).toBe(1);
    expect(distinctSeatLabels([seat(1, 'Ava'), seat(2, 'Ben')]).size).toBe(2);
  });

  it('rejects a comparison with one player', () => {
    expect(compareStandings([read(2, 'Ben')], seat(2, 'Ben')).ok).toBe(false);
  });

  it('rejects a comparison with the same player twice', () => {
    expect(compareStandings([read(2, 'Ben'), read(2, 'Ben')], seat(2, 'Ben')).ok).toBe(false);
  });

  it('accepts two distinct players including the refreshed seat', () => {
    expect(compareStandings([read(1, 'Ava'), read(2, 'Ben')], seat(2, 'Ben')).ok).toBe(true);
  });

  it('rejects two distinct players without the refreshed seat', () => {
    expect(compareStandings([read(1, 'Ava'), read(2, 'Ben')], seat(3, 'Cara')).ok).toBe(false);
  });

  it('coverage rejects one player and duplicate players', () => {
    const base = { ran: true, revision: rev('Season', '1 / 10'), rowsCompared: 20, refreshedSeat: seat(2, 'Ben') };
    expect(refreshCoverage(true, { ...base, seats: ['2:Ben'] }).ok).toBe(false);
    expect(refreshCoverage(true, { ...base, seats: ['2:Ben', '2:Ben'] }).ok).toBe(false);
  });

  it('coverage requires the refreshed seat', () => {
    const base = { classification: 'stable-match', navigation: { observed: true }, session: { present: true }, attempts: 'attempts.json', ran: true, revision: rev('Season', '1 / 10'), rowsCompared: 20, seats: ['1:Ava', '2:Ben'] };
    expect(refreshCoverage(true, { ...base, refreshedSeat: seat(2, 'Ben') }).ok).toBe(true);
    expect(refreshCoverage(true, { ...base, refreshedSeat: seat(3, 'Cara') }).ok).toBe(false);
    expect(refreshCoverage(true, { ...base, refreshedSeat: null }).ok).toBe(false);
  });
});
