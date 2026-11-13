import type { EventView, LobbyPhase, ParticipantStatus, ParticipantView } from '../../shared/mp/types';

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

function hasResult(status: ParticipantStatus): boolean {
  return status === 'qualified' || status === 'eliminated' || status === 'playoffs' || status === 'done';
}

function isPresent(participant: ParticipantView): boolean {
  return participant.status !== 'left' && !participant.away;
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
      return season?.finishLabel ?? (season?.qualified ? 'in the playoffs' : 'out');
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
    case 'qualified':
      return 'in';
    case 'eliminated':
      return 'out';
    case 'playoffs':
      return `R${participant.rounds.length}`;
    case 'done':
      return participant.season?.champion ? 'champ' : 'out';
  }
}

export function readyLabel(participants: readonly ParticipantView[]): string {
  const present = participants.filter(isPresent);
  if (present.length === 0) return 'waiting for players';
  const ready = present.filter((entry) => hasResult(entry.status));
  return `${ready.length}/${present.length} ready`;
}

export function awaitingCount(participants: readonly ParticipantView[]): number {
  return participants.filter((entry) => isPresent(entry) && !hasResult(entry.status)).length;
}

function defaultDetail(kind: string): string {
  switch (kind) {
    case 'joined':
      return 'joined the lobby';
    case 'started':
      return 'started the season';
    case 'pick':
      return 'made a pick';
    case 'barrier':
      return 'is waiting at the playoff barrier';
    case 'playoffs_started':
      return 'the playoffs have started';
    case 'host_changed':
      return 'is the new host';
    case 'left':
      return 'left the lobby';
    default:
      return '';
  }
}

export function activityLine(event: EventView | undefined): string {
  if (!event) return 'Waiting for the first move';
  const detail = event.detail ?? defaultDetail(event.kind);
  const who = event.name ?? '';
  if (!who) return detail;
  return detail ? `${who} ${detail}` : who;
}
