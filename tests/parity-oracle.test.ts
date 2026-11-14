import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare } from './parity/compare';
import * as ours from './parity/ours';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/oracle');
const read = (name: string) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
const pools = read('pools.json').pools;

const cases: Record<string, () => unknown> = {
  ovr: () => ours.ovrCase(read('ovr.json').types),
  spin: () => {
    const { args } = read('spin.json');
    return ours.spinCase(pools, args.seeds, args.pos, args.count);
  },
  daily: () => {
    const { args } = read('daily.json');
    return ours.dailyCase(pools, read('daily.json').types, args.dates);
  },
  season: () => {
    const { args } = read('season.json');
    return ours.seasonCase(pools, args.seeds, args.team, read('season.json').types);
  },
  salary: () => ours.salaryCase(pools, read('salary.json').args.dates),
  powers: () => {
    const { args } = read('powers.json');
    return ours.powersCase(pools, args.date, args.drawSeed);
  },
  squad: () => {
    const { args } = read('squad.json');
    return ours.squadCase(pools, read('squad.json').types, args.seeds, args.team);
  },
};

describe('engine parity with the original (recorded oracle outputs)', () => {
  for (const [area, run] of Object.entries(cases)) {
    it(`${area} matches the recorded oracle output`, () => {
      const fixture = read(`${area}.json`);
      const result = compare(fixture.oracle, run());
      expect(result.diffs).toEqual([]);
      expect(result.matched).toBe(result.total);
      expect(result.total).toBeGreaterThan(0);
    });
  }
});
