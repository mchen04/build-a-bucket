import { describe, expect, it } from 'vitest';
import {
  LEAGUE_TEAMS,
  simulateLeague,
  type HumanTeamInput,
  type LeagueResult,
} from '../src/shared/engine/league';
import {
  assembleLeagueView,
  revealLeague,
  stageGamesTotal,
  type LeagueGameView,
  type LeagueView,
} from '../src/shared/mp/league';
import { mergeDelta } from '../src/shared/mp/progress';
import type { LeagueDelta, LobbyView } from '../src/shared/mp/types';
import {
  buildLeagueSlice,
  revealDataFromSlice,
  type LeagueSlice,
  type LeagueSliceCheckpoint,
  type LeagueSliceGame,
} from '../src/shared/mp/leagueSlice';

function humans(count = 8): HumanTeamInput[] {
  return LEAGUE_TEAMS.slice(0, count).map((team, index) => ({
    participantId: `00000000-0000-4000-8000-00000000000${index + 1}`,
    seat: index + 1,
    name: `Player ${index + 1}`,
    team,
    position: index % 2 === 0 ? 'guard' : 'big',
    ovr: 70 + index * 3,
    values: Object.fromEntries(
      ['jumpShot', 'finishing', 'passing', 'handles', 'perimeterDefense', 'speed', 'bounce', 'size', 'basketballIQ', 'clutch'].map(
        (attr) => [attr, 6 + (index % 4)],
      ),
    ),
  }));
}

function league(seed: string, mode: 'normal' | 'salary' | 'squad'): LeagueResult {
  return simulateLeague({ seed, era: 'current', mode, humans: humans() });
}

function revealedAt(slice: LeagueSlice, stage: number, cursor: number): number {
  const counts = slice.meta.clock.counts;
  if (stage >= 4) return counts.reduce((sum, count) => sum + count, 0);
  const prefix = counts.slice(0, stage).reduce((sum, count) => sum + count, 0);
  return prefix + Math.min(cursor, counts[stage] ?? 0);
}

function checkpointAt(slice: LeagueSlice, stage: number, cursor: number): LeagueSliceCheckpoint | null {
  if (stage >= 4) return null;
  const total = slice.meta.clock.counts[stage] ?? 0;
  const clamped = Math.max(0, Math.min(cursor, total));
  return slice.checkpoints.find((entry) => entry.stage === stage && entry.cursor === clamped) ?? null;
}

function subsetGames(slice: LeagueSlice, stage: number, cursor: number, meTeam: string | null): LeagueSliceGame[] {
  const revealed = revealedAt(slice, stage, cursor);
  const meIndex = meTeam ? LEAGUE_TEAMS.indexOf(meTeam) : -1;
  const visible = slice.games.filter((game) => game.gameNo <= revealed);
  const recent = visible.slice(-30);
  const mine = visible.filter((game) => game.home === meIndex || game.away === meIndex);
  const friends = visible.filter((game) => game.friends).slice(-20);
  const byNo = new Map<number, LeagueSliceGame>();
  for (const game of [...recent, ...mine, ...friends]) byNo.set(game.gameNo, game);
  return [...byNo.values()].sort((a, b) => a.gameNo - b.gameNo);
}

function sliceView(slice: LeagueSlice, stage: number, cursor: number, meParticipantId: string | null): LeagueView {
  const meTeam = slice.meta.humans.find((entry) => entry.participantId === meParticipantId)?.team ?? null;
  const meta =
    stage < 4
      ? {
          ...slice.meta,
          humans: slice.meta.humans.map((entry) => ({
            participantId: entry.participantId,
            team: entry.team,
            name: entry.name,
            seat: entry.seat,
          })) as typeof slice.meta.humans,
        }
      : slice.meta;
  const data = revealDataFromSlice(
    meta,
    subsetGames(slice, stage, cursor, meTeam),
    checkpointAt(slice, stage, cursor),
    stage,
  );
  return assembleLeagueView(data, stage, cursor, meParticipantId);
}

function deltaGames(slice: LeagueSlice, stage: number, sinceCursor: number, cursor: number, meTeam: string | null): LeagueGameView[] {
  const sinceRevealed = revealedAt(slice, stage, sinceCursor);
  const revealed = revealedAt(slice, stage, cursor);
  const meIndex = meTeam ? LEAGUE_TEAMS.indexOf(meTeam) : -1;
  const humanTeams = new Set(slice.meta.humans.map((entry) => entry.team));
  return slice.games
    .filter((game) => game.gameNo > sinceRevealed && game.gameNo <= revealed)
    .map((game) => ({
      gameNo: game.gameNo,
      stage: game.stage,
      home: LEAGUE_TEAMS[game.home] ?? '',
      away: LEAGUE_TEAMS[game.away] ?? '',
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      winner: LEAGUE_TEAMS[game.winner] ?? '',
      mine: game.home === meIndex || game.away === meIndex,
      friends: humanTeams.has(LEAGUE_TEAMS[game.home] ?? '') && humanTeams.has(LEAGUE_TEAMS[game.away] ?? ''),
    }));
}

function lobbyWith(league: LeagueView): LobbyView {
  return { league, participants: [], events: [], me: null } as unknown as LobbyView;
}

describe('league slice views', () => {
  for (const mode of ['normal', 'salary', 'squad'] as const) {
    for (const seed of ['slice-a', 'slice-b', 'slice-c']) {
      it(`matches the full league for ${mode} ${seed}`, () => {
        const result = league(seed, mode);
        const slice = buildLeagueSlice(result);
        for (let stage = 0; stage <= 10; stage++) {
          const total = stageGamesTotal(result, stage);
          const cursors = [...new Set([0, 1, Math.floor(total / 3), Math.floor(total / 2), Math.max(0, total - 1), total, total + 5])];
          for (const cursor of cursors) {
            for (const me of [...result.humans.map((entry) => entry.participantId), null]) {
              const expected = revealLeague(result, stage, cursor, me);
              const actual = sliceView(slice, stage, cursor, me);
              expect(actual).toEqual(expected);
              const revealed = revealedAt(slice, stage, cursor);
              for (const game of actual.games) expect(game.gameNo).toBeLessThanOrEqual(revealed);
              expect(JSON.stringify(actual)).not.toContain('participantId');
            }
          }
        }
      });
    }
  }

  it('merges a league delta into the previous view', () => {
    const result = league('slice-delta', 'normal');
    const slice = buildLeagueSlice(result);
    for (let stage = 0; stage <= 10; stage++) {
      const total = stageGamesTotal(result, stage);
      const pairs: [number, number][] = [
        [0, 1],
        [0, Math.floor(total / 2)],
        [Math.floor(total / 2), total],
        [0, total],
      ];
      for (const [sinceCursor, cursor] of pairs) {
        if (cursor <= sinceCursor) continue;
        for (const human of result.humans) {
          const prev = sliceView(slice, stage, sinceCursor, human.participantId);
          const next = sliceView(slice, stage, cursor, human.participantId);
          const delta: LeagueDelta = {
            stage,
            stageCursor: cursor,
            checkpoint: next.checkpoint,
            stageName: next.stageName,
            stageTotal: next.stageTotal,
            games: deltaGames(slice, stage, sinceCursor, cursor, human.team),
            standings: stage < 4 ? next.standings : undefined,
            my: stage < 4 ? next.my : undefined,
            playoffs: stage >= 6 ? next.playoffs : undefined,
          };
          const merged = mergeDelta(lobbyWith(prev), { version: 1, serverTime: '', events: [], league: delta });
          expect(merged.league).toEqual(next);
        }
      }
    }
  });

  it('stores a checkpoint for every regular cursor', () => {
    const result = league('slice-checkpoints', 'normal');
    const slice = buildLeagueSlice(result);
    for (let stage = 0; stage <= 3; stage++) {
      const total = slice.meta.clock.counts[stage] ?? 0;
      const rows = slice.checkpoints.filter((entry) => entry.stage === stage);
      expect(rows).toHaveLength(total + 1);
      expect(rows[0]?.cursor).toBe(0);
      expect(rows[rows.length - 1]?.cursor).toBe(total);
    }
  });
});
