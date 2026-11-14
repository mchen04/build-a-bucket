import { describe, expect, it } from 'vitest';
import { dailyFinish, dailyResult } from '../src/app/mp/dailyResult';
import { GUARD_ATTRS } from '../src/shared/engine/rules';
import type { GameLine, PlayoffRound, SeasonResult } from '../src/shared/engine/types';
import { createRun, type RunState } from '../src/shared/run';
import { dailyDay, saveDailyDay, type DailyDay } from '../src/shared/modes';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function game(g: number, won: boolean): GameLine {
  return { g, won, home: true, opponent: 'NYK', mySc: 110, oppSc: 100, pts: 30, reb: 8, ast: 6 };
}

function series(name: string, won: boolean): PlayoffRound {
  return {
    type: 'series',
    name,
    roundIndex: 1,
    opponent: { short: 'NYK', wins: 50, losses: 32, seed: 2 },
    won,
    wins: won ? 4 : 2,
    losses: won ? 2 : 4,
    games: ['W', 'W', 'L', 'W', 'W', 'L'],
  };
}

function season(): SeasonResult {
  return {
    ovr: 88,
    archetype: 'Sharpshooter',
    wins: 66,
    losses: 16,
    position: 'guard',
    ppg: 22.7,
    rpg: 5.1,
    apg: 6.2,
    spg: 1.4,
    bpg: 0.6,
    tov: 2.1,
    fgPct: 0.48,
    threePct: 0.39,
    ftPct: 0.88,
    per: 23.9,
    games: [game(1, true)],
    gameLog: Array.from({ length: 82 }, (_, index) => (index % 3 === 0 ? 'L' : 'W')),
    bestGame: game(1, true),
    conference: 'east',
    seed: 3,
    madePlayoffs: true,
    standings: [
      { short: 'BOS', wins: 66, losses: 16, isUs: true },
      { short: 'NYK', wins: 60, losses: 22 },
    ],
    playoffRounds: [series('Conference Finals', false)],
    champion: false,
    team: 'BOS',
    mvp: false,
    dpoy: true,
    finalsOpp: null,
    finalsSeries: null,
    displayMvp: { name: 'Nikola Jokic', short: 'JOK', team: 'DEN', isPlayer: false },
    displayDpoy: { name: 'You', short: 'YOU', team: 'BOS', isPlayer: true },
    goatRank: null,
  };
}

function fullDay(): DailyDay {
  const picks = Object.fromEntries(
    GUARD_ATTRS.map((attr, index) => [
      attr,
      { attr, val: 8, playerName: `Player ${index + 1}`, playerShort: `P${index + 1}`, team: 'BOS' },
    ]),
  );
  const run: RunState = { ...createRun('daily-seed', 'guard', 'current'), picks, team: 'BOS', season: season(), screen: 'end' };
  return { v: 1, key: '2026-11-13', spins: 10, done: true, forfeit: false, ovr: 88, run };
}

describe('daily result', () => {
  it('keeps the full saved result shape', () => {
    const view = dailyResult(fullDay());
    expect(view.hasResult).toBe(true);
    expect(view.fallback).toBe(false);
    expect(view.ovr).toBe(88);
    expect(view.archetype).toBe('Sharpshooter');
    expect(view.record).toBe('66-16');
    expect(view.seed).toBe(3);
    expect(view.per).toBe(23.9);
    expect(view.stats).toHaveLength(5);
    expect(view.stats[0]).toEqual({ label: 'PPG', value: '22.7' });
    expect(view.build).toHaveLength(10);
    expect(view.build[0]).toMatchObject({ grade: 'A-', tone: 'grade-a', playerName: 'Player 1' });
    expect(view.awards).toHaveLength(2);
    expect(view.awards[1]).toMatchObject({ label: 'DPOY', mine: true });
    expect(view.finish).toBe('Conference Finals');
    expect(view.rounds).toHaveLength(1);
    expect(view.rounds[0]).toMatchObject({ label: 'Conference Finals', result: '2-4', won: false });
    expect(view.run).toHaveLength(82);
    expect(view.bestGame?.pts).toBe(30);
  });

  it('survives the daily store and reload', () => {
    const storage = memoryStorage();
    saveDailyDay(fullDay(), storage);
    const read = dailyDay('2026-11-13', storage);
    expect(read.done).toBe(true);
    expect(Object.keys(read.run?.picks ?? {})).toHaveLength(10);
    expect(read.run?.season?.wins).toBe(66);
    const view = dailyResult(read);
    expect(view.build).toHaveLength(10);
    expect(view.finish).toBe('Conference Finals');
  });

  it('keeps the stored seed when a strong record lands in a deep conference', () => {
    const day = fullDay();
    const view = dailyResult({ ...day, run: { ...day.run!, season: { ...season(), wins: 62, losses: 20, seed: 8 } } });
    expect(view.record).toBe('62-20');
    expect(view.seed).toBe(8);
  });

  it('falls back for an old save without a run', () => {
    const view = dailyResult({ ...fullDay(), run: null });
    expect(view.hasResult).toBe(true);
    expect(view.fallback).toBe(true);
    expect(view.ovr).toBe(88);
    expect(view.build).toEqual([]);
    expect(view.stats).toEqual([]);
    expect(view.finish).toBe('No result');
    expect(view.season).toBeNull();
  });

  it('tolerates missing fields in an old saved season', () => {
    const partialSeason = {
      ...season(),
      displayMvp: undefined,
      displayDpoy: undefined,
      bestGame: undefined,
      gameLog: undefined,
    } as unknown as SeasonResult;
    const day = fullDay();
    const view = dailyResult({ ...day, run: { ...day.run!, season: partialSeason } });
    expect(view.awards).toEqual([]);
    expect(view.bestGame).toBeNull();
    expect(view.run).toBe('');
    expect(view.stats).toHaveLength(5);
    expect(view.fallback).toBe(false);
    expect(view.finish).toBe('Conference Finals');
    expect(view.build).toHaveLength(10);
  });

  it('names the exact finish', () => {
    expect(dailyFinish({ ...season(), champion: true })).toBe('Champions');
    expect(dailyFinish({ ...season(), playoffRounds: [series('NBA Finals', false)] })).toBe('NBA Finals');
    expect(dailyFinish({ ...season(), playoffRounds: [series('First Round', false)] })).toBe('First Round');
    expect(
      dailyFinish({
        ...season(),
        madePlayoffs: false,
        playoffRounds: [
          { type: 'playin', advanced: false, newSeed: null, games: ['L'], opponent: { short: 'NYK', wins: 50 }, label: '9 vs 10' },
        ],
      }),
    ).toBe('Play-In loss');
    expect(dailyFinish({ ...season(), playoffRounds: [] })).toBe('Missed playoffs');
  });
});
