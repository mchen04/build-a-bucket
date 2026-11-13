import { describe, expect, it } from 'vitest';
import { honorsFor, honorScore, squadSeason, squadStarters, squadStrength, type SquadBuild } from '../src/shared/engine/squad';
import { buildFromCards, dailyGrid, SAL_COLUMNS, salaryPool } from '../src/shared/engine/salary';
import { GOLDEN_SQUAD } from './fixtures/golden';
import { SAL_BIGS, SAL_GUARDS, SAL_LEGENDS } from './fixtures/modes';

const pool = salaryPool(SAL_GUARDS, SAL_BIGS, SAL_LEGENDS);
const guards = pool.filter((player) => (player.posGroup ? player.posGroup !== 'big' : true)) as typeof SAL_GUARDS;
const bigs = pool.filter((player) => (player as { posGroup?: string }).posGroup === 'big') as typeof SAL_BIGS;

function buildFor(index: number, pos: 'guard' | 'big'): SquadBuild {
  const source = pos === 'guard' ? SAL_GUARDS[index] : SAL_BIGS[index];
  return { pos, values: { ...(source?.attrs ?? {}) } };
}

const squad: SquadBuild[] = [buildFor(0, 'guard'), buildFor(1, 'guard'), buildFor(2, 'guard'), buildFor(0, 'big'), buildFor(1, 'big')];

describe('squad strength', () => {
  it('matches the traced strength for a fixed squad', () => {
    const starters = squadStarters('DAL', guards, bigs);
    const strength = squadStrength('DAL', starters, squad);
    expect(strength.baseOff).toBe(GOLDEN_SQUAD.strength.baseOff);
    expect(strength.baseDef).toBe(GOLDEN_SQUAD.strength.baseDef);
    expect(strength.off).toBeCloseTo(GOLDEN_SQUAD.strength.off, 6);
    expect(strength.def).toBeCloseTo(GOLDEN_SQUAD.strength.def, 6);
    expect(strength.moves.map((move) => move.delta)).toEqual(GOLDEN_SQUAD.strength.moves.map((move) => move.delta));
  });

  it('moves the guard offense and the big defense most', () => {
    const starters = squadStarters('DAL', guards, bigs);
    const guardsOnly = squadStrength('DAL', starters, squad.slice(0, 3));
    const bigsOnly = squadStrength('DAL', starters, squad.slice(3));
    expect(guardsOnly.off - guardsOnly.baseOff).not.toBe(bigsOnly.def - bigsOnly.baseDef);
  });
});

describe('squad season', () => {
  it('plays the traced seeded season', () => {
    const starters = squadStarters('DAL', guards, bigs);
    const strength = squadStrength('DAL', starters, squad);
    const season = squadSeason(GOLDEN_SQUAD.seed, 'DAL', strength);
    expect(season.wins).toBe(GOLDEN_SQUAD.script.wins);
    expect(season.losses).toBe(GOLDEN_SQUAD.script.losses);
    expect(season.seedNumber).toBe(GOLDEN_SQUAD.script.seed);
    expect(season.conference).toBe(GOLDEN_SQUAD.script.conference);
    expect(season.champion).toBe(GOLDEN_SQUAD.script.champion);
    expect(season.madePlayoffs).toBe(GOLDEN_SQUAD.script.madePlayoffs);
    expect(season.winProb).toBeCloseTo(GOLDEN_SQUAD.script.winProb, 10);
    expect(season.log).toBe(GOLDEN_SQUAD.script.log);
  });

  it('numbers seasons from the squad seed', () => {
    const starters = squadStarters('DAL', guards, bigs);
    const strength = squadStrength('DAL', starters, squad);
    const first = squadSeason('sq-fix-season-1', 'DAL', strength);
    const second = squadSeason('sq-fix-season-1', 'DAL', strength);
    expect(second.log).toBe(first.log);
    expect(squadSeason('sq-fix-season-2', 'DAL', strength).log).not.toBe(first.log);
  });
});

describe('squad honors', () => {
  it('scores the composite and caps the honours', () => {
    expect(honorScore({ ppg: 30, rpg: 8, apg: 8, spg: 1.5, bpg: 0.5 }, 55)).toBeCloseTo(30 + 9.6 + 12 + 4 + 1.12, 6);
    const lines = [
      { id: 'PG', ppg: 32, rpg: 9, apg: 9, spg: 1.6, bpg: 0.4 },
      { id: 'SG', ppg: 30, rpg: 8, apg: 8, spg: 1.5, bpg: 0.3 },
      { id: 'SF', ppg: 28, rpg: 7, apg: 7, spg: 1.2, bpg: 0.3 },
      { id: 'PF', ppg: 26, rpg: 6, apg: 6, spg: 1, bpg: 0.2 },
      { id: 'C', ppg: 24, rpg: 5, apg: 5, spg: 0.8, bpg: 0.2 },
    ];
    const honors = honorsFor(lines, 60);
    expect(Object.values(honors).filter((honor) => honor.startsWith('AN')).length).toBeLessThanOrEqual(2);
    expect(Object.keys(honors).length).toBeLessThanOrEqual(4);
  });

  it('gives a weak season no honours', () => {
    const lines = [{ id: 'PG', ppg: 12, rpg: 3, apg: 3, spg: 0.6, bpg: 0.1 }];
    expect(honorsFor(lines, 20)).toEqual({});
  });
});

describe('squad builds reuse the salary columns', () => {
  it('reads a player card into build values', () => {
    const cards = SAL_COLUMNS.map((column) => dailyGrid([column], pool, '2026-11-13')[0]?.[0]);
    const { values } = buildFromCards(cards as NonNullable<(typeof cards)[number]>[]);
    expect(Object.keys(values)).toContain('jumpShot');
    expect(values.basketballIQ).toBeGreaterThan(0);
  });
});
