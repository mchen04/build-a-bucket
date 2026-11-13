import type { LobbyPhase, ParticipantView } from '../../shared/mp/types';

export function phaseLabel(phase: LobbyPhase): string {
  switch (phase) {
    case 'lobby':
      return 'In the lobby';
    case 'building':
      return 'Building';
    case 'season':
      return 'Season running';
    case 'barrier':
      return 'Barrier';
    case 'playoffs':
      return 'Playoffs';
    case 'finished':
      return 'Finished';
  }
}

export function statusLine(participant: ParticipantView, phase: LobbyPhase): string {
  if (participant.status === 'left') return 'left';
  if (participant.away) return 'away';
  const season = participant.season;
  switch (participant.status) {
    case 'joined':
      return phase === 'lobby' ? 'ready' : 'building';
    case 'building': {
      const filled = participant.summary?.filled ?? 0;
      const latest = participant.summary?.latest;
      return latest ? `${filled}/10 · ${latest}` : `${filled}/10`;
    }
    case 'built':
    case 'season_done':
      return 'simming…';
    case 'qualified':
    case 'eliminated':
      if (!season) return 'simming…';
      return `${season.wins}-${season.losses} · #${season.seed}${season.qualified ? ' · in' : ' · out'}`;
    case 'playoffs': {
      const last = participant.rounds[participant.rounds.length - 1];
      if (!last) return 'in the playoffs';
      return `${last.name}: ${last.wins}-${last.losses}`;
    }
    case 'done':
      return season ? season.finishLabel : 'out';
  }
}

export function shortStatus(participant: ParticipantView, phase: LobbyPhase): string {
  if (participant.status === 'left') return 'left';
  if (participant.away) return 'away';
  switch (participant.status) {
    case 'joined':
      return phase === 'lobby' ? 'ready' : '—';
    case 'building':
      return `${participant.summary?.filled ?? 0}/10`;
    case 'built':
    case 'season_done':
      return 'sim';
    case 'qualified':
      return 'in';
    case 'eliminated':
      return 'out';
    case 'playoffs':
      return `R${participant.rounds.length}`;
    case 'done':
      return participant.season?.champion ? 'won' : 'out';
  }
}

export function readyCount(participants: readonly ParticipantView[]): number {
  return participants.filter(
    (entry) => entry.status === 'qualified' || entry.status === 'eliminated' || entry.status === 'done',
  ).length;
}

export function awaitingCount(participants: readonly ParticipantView[]): number {
  return participants.filter(
    (entry) =>
      entry.status !== 'left' &&
      !entry.away &&
      entry.status !== 'qualified' &&
      entry.status !== 'eliminated' &&
      entry.status !== 'done',
  ).length;
}
