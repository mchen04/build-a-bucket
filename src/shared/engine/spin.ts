import { seededShuffle, weightedShuffle } from './rng';
import type { Player } from './types';

export interface SpinTarget {
  team: string;
  player: Player;
}

export interface SpinRecord {
  attr: string;
  team: string;
  playerName: string;
  teamRespin: boolean;
  playerRespin: boolean;
}

export function teamCandidates(pool: readonly Player[]): string[] {
  return [...new Set(pool.map((player) => player.team))].sort((a, b) => a.localeCompare(b));
}

export function teamPlayers(pool: readonly Player[], team: string): Player[] {
  return pool.filter((player) => player.team === team).sort((a, b) => a.name.localeCompare(b.name));
}

export function spinTarget(
  pool: readonly Player[],
  seed: string,
  spinIndex: number,
  teamRespin: boolean,
  playerRespinCount: number,
  respinSeed: string,
): SpinTarget | null {
  const teams = teamCandidates(pool);
  if (teams.length === 0) return null;
  const weighted = teams.map((short) => ({ short, w: 1 }));
  const team = teamRespin
    ? weightedShuffle(weighted, `${respinSeed}:teams:${spinIndex}`)[0]?.short
    : weightedShuffle(weighted, `${seed}:teams`)[spinIndex % teams.length]?.short;
  if (!team) return null;
  const players = teamPlayers(pool, team);
  if (players.length === 0) return null;
  if (teamRespin) {
    const shuffled = seededShuffle(players, `${respinSeed}:${spinIndex}:${team}`);
    return { team, player: shuffled[playerRespinCount % shuffled.length] as Player };
  }
  if (playerRespinCount > 0) {
    const shuffled = seededShuffle(players, `${respinSeed}:${spinIndex}:${team}`);
    const original = seededShuffle(players, `${seed}:${spinIndex}:${team}`)[0];
    const rest = shuffled.filter((player) => player.name !== original?.name);
    const player = rest.length > 0 ? rest[(playerRespinCount - 1) % rest.length] : shuffled[0];
    return player ? { team, player } : null;
  }
  const shuffled = seededShuffle(players, `${seed}:${spinIndex}:${team}`);
  const player = shuffled[0];
  return player ? { team, player } : null;
}
