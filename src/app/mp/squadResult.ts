import type { SquadRound, SquadSeasonResult } from '../../shared/engine/squad';
import type { SquadStage } from '../../shared/squadStore';

export function squadFinish(season: SquadSeasonResult): string {
  const last = season.rounds[season.rounds.length - 1];
  if (last?.type === 'playin' && !last.won) return 'Eliminated in Play-In';
  if (!season.madePlayoffs) return 'Missed the Playoffs';
  if (season.champion) {
    return last ? `${season.wins}-${season.losses} Season · ${last.wins}-${last.losses} vs ${last.opponent}` : `${season.wins}-${season.losses} Season`;
  }
  if (!last) return 'Season Ended';
  if (last.type === 'playin') return 'Play-In';
  return `Eliminated · ${last.name ?? 'Playoffs'} · ${last.wins}-${last.losses} vs ${last.opponent}`;
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
