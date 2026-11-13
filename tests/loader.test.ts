import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import JSON5 from 'json5';
import { DataError, extractLiteral, loadCareerAges, loadCatalog, parseAges, poolFor, headshotFor } from '../src/shared/data/loader';
import { PlayerListSchema, TeamListSchema } from '../src/shared/data/schemas';

const FIXTURE_SOURCE = `import { NBA_TEAMS } from './nba-teams'

// A fixture written in the shape of the pinned data files.
export const GUARD_TYPES = ["jumpShot", "finishing"]

export const NBA_GUARD_PLAYERS = [
  {
    name: "Fixture [One]",
    short: "One",
    team: "AAA",
    starter: true,
    number: 3,
    attrs: { jumpShot: 7, finishing: 4 },
  },
  /* two */
  { name: "Fixture Two", short: "Two", team: "BBB", attrs: { jumpShot: 2, finishing: 9 } },
]

export const NBA_TEAMS = [
  { short: "AAA", name: "Alpha", color: "#111111", color2: "#222222" },
  { short: "BBB", name: "Beta", color: "#333333", color2: "#444444" },
]
`;

const offline = process.env.BAB_SKIP_NETWORK === '1';

describe('extractLiteral', () => {
  it('pulls a literal out of a fixture file', () => {
    const literal = extractLiteral(FIXTURE_SOURCE, 'NBA_GUARD_PLAYERS');
    expect(literal.startsWith('[')).toBe(true);
    expect(literal.endsWith(']')).toBe(true);
    const players = v.parse(PlayerListSchema, JSON5.parse(literal));
    expect(players).toHaveLength(2);
    expect(players[0]?.name).toBe('Fixture [One]');
    expect(players[0]?.attrs.jumpShot).toBe(7);
    expect(players[1]?.team).toBe('BBB');
  });

  it('pulls a second literal out of the same fixture file', () => {
    const teams = v.parse(TeamListSchema, JSON5.parse(extractLiteral(FIXTURE_SOURCE, 'NBA_TEAMS')));
    expect(teams.map((team) => team.short)).toEqual(['AAA', 'BBB']);
  });

  it('fails loudly when the export is missing', () => {
    expect(() => extractLiteral(FIXTURE_SOURCE, 'NBA_NOPE')).toThrow(DataError);
  });

  it('fails loudly when the literal is unterminated', () => {
    expect(() => extractLiteral('export const A = [1, 2', 'A')).toThrow(DataError);
  });

  it('rejects a literal that is not an array or object', () => {
    expect(() => extractLiteral('export const A = 3', 'A')).toThrow(DataError);
  });

  it('skips braces inside strings and comments', () => {
    const source = 'export const A = ["}", "\\\\"]\n// }\n';
    expect(extractLiteral(source, 'A')).toBe('["}", "\\\\"]');
  });
});

describe('pinned data files', () => {
  it.skipIf(offline)('loads and validates the pinned catalog', async () => {
    const catalog = await loadCatalog();
    expect(catalog.teams).toHaveLength(30);
    expect(catalog.currentGuards).toHaveLength(274);
    expect(catalog.currentBigs).toHaveLength(127);
    expect(catalog.legendGuards).toHaveLength(145);
    expect(catalog.legendBigs).toHaveLength(110);
    expect(Object.keys(catalog.headshots).length).toBeGreaterThan(600);

    const guard = catalog.currentGuards[0];
    expect(guard?.name.length).toBeGreaterThan(0);
    expect(guard?.team.length).toBe(3);
    expect(guard?.attrs.jumpShot).toBeGreaterThanOrEqual(0);
    expect(guard?.attrs.jumpShot).toBeLessThanOrEqual(11);

    const legend = catalog.legendGuards[0];
    expect(legend?.years).toBeDefined();

    expect(poolFor(catalog, 'guard', 'current')).toHaveLength(274);
    expect(poolFor(catalog, 'big', 'alltime')).toHaveLength(110);
    expect(headshotFor(catalog, guard as NonNullable<typeof guard>)).toMatch(/^https:\/\/cdn\.jsdelivr\.net\//);
  });
});

const AGES_SOURCE = `// Birth years for the real players in the current pools.
export const BIRTH_NFL = {
  "Fixture Receiver": 2001,
  "Another Fixture": 1995,
}

export const BIRTH_NBA = {
  "Fixture Guard": 1998,
  "Fixture Big": 2000,
}

export const BIRTH = { nfl: BIRTH_NFL, bucket: BIRTH_NBA }
`;

describe('extractLiteral identifiers', () => {
  it('matches the exact export instead of a longer name that shares its prefix', () => {
    expect(extractLiteral(AGES_SOURCE, 'BIRTH')).toBe('{ nfl: BIRTH_NFL, bucket: BIRTH_NBA }');
  });

  it('does not match a longer identifier that starts with the requested name', () => {
    expect(() => extractLiteral('export const BIRTH_NFL = { "Fixture": 2001 }', 'BIRTH')).toThrow(DataError);
  });

  it('reads a table declared after a longer sibling name', () => {
    const literal = extractLiteral(AGES_SOURCE, 'BIRTH_NBA');
    expect(literal.startsWith('{')).toBe(true);
    expect(literal.includes('Fixture Guard')).toBe(true);
    expect(literal.includes('Fixture Receiver')).toBe(false);
  });
});

describe('career ages', () => {
  it('reads the basketball table from a file shaped like the pinned one', () => {
    expect(parseAges(AGES_SOURCE)).toEqual({ 'Fixture Guard': 1998, 'Fixture Big': 2000 });
  });

  it.skipIf(offline)('reads the pinned player ages', async () => {
    const ages = await loadCareerAges();
    expect(ages).not.toBeNull();
    expect(Object.keys(ages ?? {}).length).toBeGreaterThan(300);
    expect(ages?.['Stephen Curry']).toBe(1988);
  });
});
