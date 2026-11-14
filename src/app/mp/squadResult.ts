import type { SquadRound, SquadSeasonResult } from '../../shared/engine/squad';
import type { SquadStage } from '../../shared/squadStore';

export function squadFinish(season: SquadSeasonResult): string {
  if (season.champion) return 'Champions';
  const last = season.rounds[season.rounds.length - 1];
  if (!last) return 'Missed playoffs';
  if (last.type === 'playin') return last.won ? 'Play-In' : 'Play-In loss';
  return last.name ?? 'Playoffs';
}

export function squadFinishVisible(stage: SquadStage, revealed: number, rounds: SquadRound[]): boolean {
  if (stage === 'recap') return true;
  return stage === 'playoffs' && revealed >= rounds.length;
}

export function squadRoundLabel(round: SquadRound): string {
  return round.type === 'playin' ? 'Play-In' : round.name ?? 'Playoffs';
}

export function squadRoundResult(round: SquadRound): string {
  return `${round.wins ?? 0}-${round.losses ?? 0}`;
}
