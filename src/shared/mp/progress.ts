import {
  EVENT_LIMIT,
  type LeagueDelta,
  type LobbyDelta,
  type LobbyView,
  type ParticipantProgress,
  type ParticipantView,
} from './types.js';
import type { LeagueGameView, LeagueView } from './league.js';

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
  const progress = new Map<number, ParticipantProgress>((delta.participants ?? []).map((entry) => [entry.seat, entry]));
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
    league: delta.league && view.league ? mergeLeagueDelta(view.league, delta.league) : view.league,
  };
}

function mergeLeagueGames(current: LeagueGameView[], incoming: LeagueGameView[]): LeagueGameView[] {
  if (!incoming.length) return current;
  const byNo = new Map(current.map((game) => [game.gameNo, game]));
  for (const game of incoming) byNo.set(game.gameNo, game);
  const all = [...byNo.values()].sort((a, b) => a.gameNo - b.gameNo);
  const latest = all[all.length - 1]?.gameNo ?? 0;
  const keep = new Set<number>();
  for (const game of all) if (game.gameNo > latest - 30 || game.mine) keep.add(game.gameNo);
  for (const game of all.filter((entry) => entry.friends).slice(-20)) keep.add(game.gameNo);
  return all.filter((game) => keep.has(game.gameNo));
}

function mergeLeagueDelta(view: LeagueView, delta: LeagueDelta): LeagueView {
  return {
    ...view,
    stage: delta.stage,
    cursor: delta.stageCursor,
    checkpoint: delta.checkpoint,
    stageName: delta.stageName,
    stageTotal: delta.stageTotal,
    games: mergeLeagueGames(view.games, delta.games),
    standings: delta.standings !== undefined ? delta.standings : view.standings,
    my: delta.my !== undefined ? delta.my : view.my,
    playoffs: delta.playoffs !== undefined ? delta.playoffs : view.playoffs,
  };
}
