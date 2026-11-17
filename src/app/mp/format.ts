import type { EventView, LobbyPhase, ParticipantView, ReadyView } from '../../shared/mp/types';

export function phaseLabel(phase: LobbyPhase): string {
  switch (phase) {
    case 'lobby':
      return 'In the lobby';
    case 'draw':
      return 'Team draw';
    case 'building':
      return 'Building';
    case 'preview':
      return 'Team preview';
    case 'season':
      return 'Season running';
    case 'awards':
      return 'Awards';
    case 'playin':
      return 'Play-In';
    case 'playoffs':
      return 'Playoffs';
    case 'recap':
      return 'Recap';
    case 'rematch':
      return 'Play again';
  }
}

export function statusLine(participant: ParticipantView, phase: LobbyPhase): string {
  if (participant.status === 'left') return 'left';
  if (participant.away) return 'away';
  if (phase === 'preview' || phase === 'rematch') return participant.ready ? 'ready' : 'waiting';
  if (phase === 'building') {
    if (participant.summary) return `${participant.summary.filled}/${participant.summary.total}`;
    if (participant.status === 'ready') return 'ready';
    return participant.team ?? 'building';
  }
  if (phase === 'draw') return participant.team ?? 'drawing';
  if (phase === 'lobby') return 'in';
  if (participant.season) {
    const record = `${participant.season.wins}-${participant.season.losses}`;
    if (participant.season.finish) return `${participant.season.finish} · ${record}`;
    if (participant.season.seed) return `${record} · #${participant.season.seed}`;
    return record;
  }
  return participant.team ?? '—';
}

export function shortStatus(participant: ParticipantView, phase: LobbyPhase): string {
  if (participant.status === 'left') return 'left';
  if (participant.away) return 'away';
  if (phase === 'building') {
    if (participant.summary) return `${participant.summary.filled}/${participant.summary.total}`;
    if (participant.status === 'ready') return 'ready';
    return participant.team ?? 'building';
  }
  if (phase === 'preview' || phase === 'rematch') return participant.ready ? 'ready' : 'waiting';
  if (phase === 'draw') return participant.team ?? 'drawing';
  if (phase === 'lobby') return 'in';
  return participant.team ?? '—';
}

export function readyLabel(ready: ReadyView): string {
  return `${ready.ready}/${ready.present} ready`;
}

function defaultDetail(kind: string): string {
  switch (kind) {
    case 'joined':
      return 'joined the lobby';
    case 'started':
      return 'started the league';
    case 'draw':
      return 'drew a team';
    case 'reroll':
      return 'rerolled a team';
    case 'locked':
      return 'locked the teams';
    case 'submitted':
      return 'submitted a build';
    case 'checkpoint':
      return 'reached a checkpoint';
    case 'rematch':
      return 'started a rematch';
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
  if (!detail) return who;
  if (detail === who || detail.startsWith(`${who} `) || detail.startsWith(`${who}'s `)) return detail;
  return `${who} ${detail}`;
}
