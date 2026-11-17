import { describe, expect, it } from 'vitest';
import { teamCandidates, teamPlayers, spinTarget } from '../src/shared/engine/spin';
import { POOL } from './fixtures/pool';

const SEED = 'b-golden-1';
const RESPIN = `${SEED}:r`;

function target(spinIndex: number, teamRespin = false, playerRespinCount = 0) {
  const result = spinTarget(POOL, SEED, spinIndex, teamRespin, playerRespinCount, RESPIN);
  if (!result) throw new Error('no target');
  return `${result.team}/${result.player.name}`;
}

describe('spin targets', () => {
  it('sorts the candidate teams and players', () => {
    expect(teamCandidates(POOL)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(teamPlayers(POOL, 'CCC').map((player) => player.name)).toEqual(['Eli Pike', 'Fay Quinn', 'Gus Reed']);
  });

  it('matches the traced sequence for a fixed seed', () => {
    expect(target(0)).toBe('BBB/Cy Marsh');
    expect(target(1)).toBe('AAA/Ben Ortiz');
    expect(target(2)).toBe('CCC/Eli Pike');
    expect(target(3)).toBe('BBB/Cy Marsh');
  });

  it('matches the traced team respin sequence for a fixed seed', () => {
    expect(target(0, true)).toBe('CCC/Gus Reed');
    expect(target(1, true)).toBe('CCC/Fay Quinn');
    expect(target(2, true)).toBe('AAA/Ada Fox');
    expect(target(3, true)).toBe('CCC/Gus Reed');
  });

  it('matches the traced player respin sequence', () => {
    expect(target(0, false, 1)).toBe('BBB/Dee Novak');
    expect(target(1, false, 1)).toBe('AAA/Ada Fox');
    expect(target(2, false, 1)).toBe('CCC/Gus Reed');
  });

  it('never returns the excluded player on a player respin', () => {
    for (let spinIndex = 0; spinIndex < 12; spinIndex++) {
      const first = spinTarget(POOL, SEED, spinIndex, false, 0, RESPIN);
      const respun = spinTarget(POOL, SEED, spinIndex, false, 1, RESPIN);
      expect(first).not.toBeNull();
      expect(respun).not.toBeNull();
      expect(respun?.team).toBe(first?.team);
      expect(respun?.player.name).not.toBe(first?.player.name);
    }
  });

  it('keeps the player on the respun team', () => {
    for (let spinIndex = 0; spinIndex < 12; spinIndex++) {
      const result = spinTarget(POOL, SEED, spinIndex, true, 0, RESPIN);
      expect(result).not.toBeNull();
      expect(result?.player.team).toBe(result?.team);
    }
  });

  it('keeps the respun team on a later player respin', () => {
    for (let spinIndex = 0; spinIndex < 12; spinIndex++) {
      const respunTeam = spinTarget(POOL, SEED, spinIndex, true, 0, RESPIN);
      const thenPlayer = spinTarget(POOL, SEED, spinIndex, true, 1, RESPIN);
      expect(thenPlayer?.team).toBe(respunTeam?.team);
      if (teamPlayers(POOL, respunTeam?.team ?? '').length > 1) {
        expect(thenPlayer?.player.name).not.toBe(respunTeam?.player.name);
      }
    }
  });

  it('returns null for an empty pool', () => {
    expect(spinTarget([], SEED, 0, false, 0, RESPIN)).toBeNull();
  });
});
