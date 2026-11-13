import { describe, expect, it } from 'vitest';
import type { SquadRound, SquadSeasonResult } from '../src/shared/engine/squad';
import type { SquadStage } from '../src/shared/squadStore';
import { squadFinish, squadFinishVisible, squadRoundLabel, squadRoundResult } from '../src/app/mp/squadResult';

const playinWin: SquadRound = { type: 'playin', name: null, opponent: 'PHX', wins: 1, losses: 0, won: true, label: '9 vs 10' };
const playinLoss: SquadRound = { type: 'playin', name: null, opponent: 'PHX', wins: 0, losses: 1, won: false, label: '9 vs 10' };
const firstWin: SquadRound = { type: 'series', name: 'First Round', opponent: 'DEN', wins: 4, losses: 2, won: true, label: null };
const firstLoss: SquadRound = { type: 'series', name: 'First Round', opponent: 'DEN', wins: 2, losses: 4, won: false, label: null };
const finalsLoss: SquadRound = { type: 'series', name: 'NBA Finals', opponent: 'BOS', wins: 2, losses: 4, won: false, label: null };

function season(overrides: Partial<SquadSeasonResult> = {}): SquadSeasonResult {
  return {
    seed: 'sq-test',
    wins: 45,
    losses: 37,
    seedNumber: 7,
    conference: 'west',
    champion: false,
    madePlayoffs: true,
    winProb: 0.5,
    log: 'W'.repeat(45) + 'L'.repeat(37),
    rounds: [playinWin, firstWin, finalsLoss],
    standings: [{ short: 'DAL', wins: 45, losses: 37, isUs: true }],
    ...overrides,
  };
}

describe('squad result', () => {
  it('names the exact finish', () => {
    expect(squadFinish(season({ champion: true }))).toBe('Champions');
    expect(squadFinish(season({ rounds: [playinWin, firstWin, finalsLoss] }))).toBe('NBA Finals');
    expect(squadFinish(season({ rounds: [playinWin, firstLoss] }))).toBe('First Round');
    expect(squadFinish(season({ rounds: [playinLoss], madePlayoffs: false }))).toBe('Play-In loss');
    expect(squadFinish(season({ rounds: [playinWin] }))).toBe('Play-In');
    expect(squadFinish(season({ rounds: [], madePlayoffs: false }))).toBe('Missed playoffs');
  });

  it('never reveals the finish before the playoff journey ends', () => {
    const rounds = [playinWin, firstWin, finalsLoss];
    const stages: SquadStage[] = ['build', 'review', 'season', 'standings'];
    for (const stage of stages) expect(squadFinishVisible(stage, rounds.length, rounds)).toBe(false);
    expect(squadFinishVisible('playoffs', 0, rounds)).toBe(false);
    expect(squadFinishVisible('playoffs', 1, rounds)).toBe(false);
    expect(squadFinishVisible('playoffs', 2, rounds)).toBe(false);
    expect(squadFinishVisible('playoffs', 3, rounds)).toBe(true);
    expect(squadFinishVisible('recap', 0, rounds)).toBe(true);
  });

  it('labels and scores each round', () => {
    expect(squadRoundLabel(playinWin)).toBe('Play-In');
    expect(squadRoundResult(playinWin)).toBe('1-0');
    expect(squadRoundLabel(finalsLoss)).toBe('NBA Finals');
    expect(squadRoundResult(finalsLoss)).toBe('2-4');
  });

  it('keeps losses in the standings', () => {
    const result = season();
    expect(result.standings[0]).toMatchObject({ short: 'DAL', wins: 45, losses: 37, isUs: true });
  });
});
