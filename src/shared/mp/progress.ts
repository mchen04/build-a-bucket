import { EVENT_LIMIT, type LobbyDelta, type LobbyView, type ParticipantProgress, type ParticipantView } from './types.js';

export function progressToken(view: Pick<LobbyView, 'events' | 'participants'>): string {
  const latest = view.events[0]?.id ?? 0;
  const away = view.participants
    .filter((entry) => entry.away)
    .map((entry) => entry.seat)
    .join(',');
  const filled = view.participants.reduce((count, entry) => count + (entry.summary?.filled ?? 0), 0);
  const teams = view.participants.map((entry) => `${entry.seat}:${entry.team ?? ''}:${entry.ready ? 1 : 0}`).join(',');
  return `${latest}:${away}:${filled}:${teams}`;
}

export function mergeDelta(view: LobbyView, delta: LobbyDelta): LobbyView {
  const progress = new Map<number, ParticipantProgress>(delta.participants.map((entry) => [entry.seat, entry]));
  const participants: ParticipantView[] = view.participants.map((entry) => {
    const next = progress.get(entry.seat);
    if (!next) return entry;
    return { ...entry, status: next.status, away: next.away, summary: next.summary, team: next.team, ready: next.ready };
  });
  return {
    ...view,
    version: delta.version,
    serverTime: delta.serverTime,
    participants,
    me: participants.find((entry) => entry.isMe) ?? view.me,
    events: [...delta.events, ...view.events].slice(0, EVENT_LIMIT),
  };
}
