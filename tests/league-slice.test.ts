import { afterEach, describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  LEAGUE_TEAMS,
  simulateLeague,
  type HumanTeamInput,
  type HumanSeason,
  type LeagueResult,
  type SeriesResult,
} from '../src/shared/engine/league';
import {
  assembleLeagueView,
  revealLeague,
  stageGamesTotal,
  type LeagueClock,
  type LeagueGameView,
  type LeagueView,
} from '../src/shared/mp/league';
import { mergeDelta } from '../src/shared/mp/progress';
import { LobbyDeltaSchema } from '../src/shared/mp/schemas';
import type { LeagueDelta, LobbyDelta, LobbyView } from '../src/shared/mp/types';
import { setRunner } from '../src/server/db';
import { readLeagueDelta } from '../src/server/leagueSlice';
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

function deltaRows(slice: LeagueSlice, stage: number, cursor: number): [number, number, number, number | null][] {
  const checkpoint = checkpointAt(slice, stage, cursor);
  if (!checkpoint) return [];
  const rows: [number, number, number, number | null][] = [];
  for (let index = 0; index + 2 < checkpoint.records.length; index += 3) {
    rows.push([checkpoint.records[index] as number, checkpoint.records[index + 1] as number, checkpoint.records[index + 2] as number, null]);
  }
  return rows;
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

  it('keeps the champion out of every playoffs view', () => {
    const result = league('slice-champion', 'normal');
    const slice = buildLeagueSlice(result);
    const me = result.humans[0]!.participantId;
    for (let stage = 6; stage <= 9; stage++) {
      const total = stageGamesTotal(result, stage);
      for (const cursor of [0, Math.floor(total / 2), total]) {
        const view = sliceView(slice, stage, cursor, me);
        expect(view.phase).toBe('playoffs');
        expect(view.recap).toBeNull();
      }
    }
    const recap = sliceView(slice, 10, 0, me);
    expect(recap.phase).toBe('recap');
    expect(recap.recap?.champion).toBeTruthy();
  });

  it('merges a league delta into the previous view', () => {
    const result = league('slice-delta', 'normal');
    expect(result.series.some((entry) => entry.games.length === 7)).toBe(true);
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
            standings: next.standings,
            my: next.my,
            awards: next.awards,
            playin: next.playin,
            playoffs: stage >= 6 ? next.playoffs : undefined,
          };
          const merged = mergeDelta(lobbyWith(prev), { version: 1, serverTime: '', events: [], league: delta });
          expect(merged.league).toEqual(next);
        }
      }
    }
  });

  it('merges a compact regular delta into the previous view', () => {
    const result = league('slice-rows', 'normal');
    const slice = buildLeagueSlice(result);
    for (let stage = 0; stage < 4; stage++) {
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
            rows: deltaRows(slice, stage, cursor),
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

  it('does not reveal the playoffs before the play-in is complete', () => {
    const result = league('slice-spoiler', 'normal');
    const total = stageGamesTotal(result, 5);
    for (const cursor of [0, 1, Math.max(0, total - 1), total]) {
      const view = revealLeague(result, 5, cursor, result.humans[0]!.participantId);
      expect(view.playoffs).toBeNull();
    }
    expect(revealLeague(result, 6, 0, result.humans[0]!.participantId).playoffs).not.toBeNull();
  });

  it('carries the awards and play-in reveal across a stage delta', () => {
    const result = league('slice-awards', 'normal');
    const slice = buildLeagueSlice(result);
    const human = result.humans[0]!;
    const prev = sliceView(slice, 3, stageGamesTotal(result, 3), human.participantId);
    const awards = sliceView(slice, 4, 0, human.participantId);
    const awardsDelta: LeagueDelta = {
      stage: 4,
      stageCursor: 0,
      checkpoint: awards.checkpoint,
      stageName: awards.stageName,
      stageTotal: awards.stageTotal,
      games: [],
      standings: awards.standings,
      my: awards.my,
      awards: awards.awards,
    };
    const mergedAwards = mergeDelta(lobbyWith(prev), { version: 1, serverTime: '', events: [], league: awardsDelta });
    expect(mergedAwards.league).toEqual(awards);
    const playin = sliceView(slice, 5, 0, human.participantId);
    const playinDelta: LeagueDelta = {
      stage: 5,
      stageCursor: 0,
      checkpoint: playin.checkpoint,
      stageName: playin.stageName,
      stageTotal: playin.stageTotal,
      games: [],
      standings: playin.standings,
      my: playin.my,
      awards: playin.awards,
      playin: playin.playin,
    };
    const mergedPlayin = mergeDelta(lobbyWith(awards), { version: 1, serverTime: '', events: [], league: playinDelta });
    expect(mergedPlayin.league).toEqual(playin);
  });

  it('updates every roster record from the compact standings rows', () => {
    const result = league('slice-roster', 'normal');
    const slice = buildLeagueSlice(result);
    for (let stage = 0; stage < 4; stage++) {
      const total = stageGamesTotal(result, stage);
      for (const cursor of [...new Set([0, 1, Math.floor(total / 2), total])]) {
        const rows = deltaRows(slice, stage, cursor);
        const participants = result.humans.flatMap((human) => {
          const row = rows.find(([index]) => LEAGUE_TEAMS[index] === human.team);
          return row
            ? [{ seat: human.seat, season: { wins: row[1], losses: row[2], seed: null, finish: null, champion: false } }]
            : [];
        });
        const full = sliceView(slice, stage, cursor, result.humans[0]!.participantId);
        const roster = result.humans.map((human) => ({
          seat: human.seat,
          name: human.name,
          isHost: human.seat === 1,
          isMe: human.seat === 1,
          away: false,
          status: 'joined',
          joinedAt: '',
          lastSeen: '',
          team: human.team,
          rerollUsed: false,
          build: null,
          summary: null,
          buildSeed: null,
          ready: false,
          season: { wins: 0, losses: 0, seed: null, finish: null, champion: false },
        }));
        const view = { ...lobbyWith(full), participants: roster } as unknown as LobbyView;
        const merged = mergeDelta(view, { version: 1, serverTime: '', events: [], participants });
        for (const human of result.humans) {
          const row = rows.find(([index]) => LEAGUE_TEAMS[index] === human.team);
          const entry = merged.participants.find((candidate) => candidate.seat === human.seat);
          expect(entry?.season).toEqual(
            row
              ? { wins: row[1], losses: row[2], seed: null, finish: null, champion: false }
              : { wins: 0, losses: 0, seed: null, finish: null, champion: false },
          );
        }
      }
    }
  });

  describe('league delta totals', () => {
    afterEach(() => setRunner(null));

    it('uses the actual series total for the checkpoint and the denominator', async () => {
      const series = [...seriesFixture(2, [7, 6, 5, 4]), ...seriesFixture(3, [7, 6])];
      setRunner({
        async query<Row>(text: string): Promise<Row[]> {
          if (text.includes('jsonb_array_elements(series)')) return [{ series }] as unknown as Row[];
          return [{ humans: [{ participantId: 'delta-me', team: series[0]!.high, name: 'Me', seat: 1 }] as unknown as HumanSeason[], east: [], west: [], clock, awards: null, playin: null, series, champion: null, h2h: null }] as unknown as Row[];
        },
        async batch(): Promise<void> {},
        async transaction<Row>(): Promise<Row[][]> {
          return [];
        },
      });
      const clock: LeagueClock = {
        counts: [0, 0, 0, 0],
        playin: 0,
        seriesCounts: [8, 4, 2, 1],
        seriesGames: [0, 22, 13, 6],
        humanSeasons: [{ participantId: 'delta-me', name: 'Delta', team: 'DET', wins: 50, losses: 32, seed: 1 }],
      };
      const mid = await readLeagueDelta('delta-total', 7, 13, 0, 'DET', clock);
      expect(mid?.stageTotal).toBe(22);
      expect(mid?.checkpoint).toBe(false);
      const done = await readLeagueDelta('delta-total', 7, 22, 0, 'DET', clock);
      expect(done?.stageTotal).toBe(22);
      expect(done?.checkpoint).toBe(true);
      expect(done?.playoffs?.flatMap((entry) => entry.games)).toHaveLength(22);
      const finalsMid = await readLeagueDelta('delta-total', 8, 12, 0, 'DET', clock);
      expect(finalsMid?.stageTotal).toBe(13);
      expect(finalsMid?.checkpoint).toBe(false);
      const finalsDone = await readLeagueDelta('delta-total', 8, 13, 0, 'DET', clock);
      expect(finalsDone?.stageTotal).toBe(13);
      expect(finalsDone?.checkpoint).toBe(true);
    });

    it('keeps my series in step with the bracket through the client schema and merge', async () => {
      const series = seriesFixture(2, [7, 6, 5, 4]);
      setRunner({
        async query<Row>(text: string): Promise<Row[]> {
          if (text.includes('jsonb_array_elements(series)')) return [{ series }] as unknown as Row[];
          return [{ humans: [{ participantId: 'delta-me', team: series[0]!.high, name: 'Me', seat: 1 }] as unknown as HumanSeason[], east: [], west: [], clock, awards: null, playin: null, series, champion: null, h2h: null }] as unknown as Row[];
        },
        async batch(): Promise<void> {},
        async transaction<Row>(): Promise<Row[][]> {
          return [];
        },
      });
      const clock: LeagueClock = { counts: [0, 0, 0, 0], playin: 0, seriesCounts: [8, 4, 2, 1], seriesGames: [0, 22, 13, 6] };
      const me = series[0]!.high;
      const delta = await readLeagueDelta('delta-my', 7, 13, 0, me, clock);
      expect(delta).toBeTruthy();
      if (!delta) return;
      const view = {
        version: 1,
        standings: [{ team: me, conference: 'east', wins: 50, losses: 32, seed: 1, isMine: true, humanName: 'Me' }],
        my: { team: me, series: { id: series[0]!.id, wins: 0, losses: 0, complete: false, winner: null, advanced: false } },
        playoffs: null,
      } as unknown as LeagueView;
      const payload = { version: 2, serverTime: new Date().toISOString(), phase: 'playoffs', events: [], participants: [], league: delta };
      expect(v.safeParse(LobbyDeltaSchema, payload).success).toBe(true);
      const merged = mergeDelta({ version: 1, league: view, participants: [], events: [] } as unknown as LobbyView, payload as unknown as LobbyDelta).league as LeagueView;
      const bracket = delta.playoffs?.find((entry) => entry.id === series[0]!.id);
      expect(merged.my?.series?.wins).toBe(bracket?.wins);
      expect(merged.my?.series?.losses).toBe(bracket?.losses);
      expect(merged.standings).toEqual(view.standings);
    });
  });
});

function seriesFixture(round: number, lengths: number[]): SeriesResult[] {
  return lengths.map((length, index) => {
    const high = LEAGUE_TEAMS[index * 2] ?? 'AAA';
    const low = LEAGUE_TEAMS[index * 2 + 1] ?? 'BBB';
    const games = Array.from({ length }, (_, gameIndex) => ({
      index: gameIndex,
      home: high,
      away: low,
      homeScore: 100 + gameIndex,
      awayScore: 99 + gameIndex,
      winner: gameIndex % 2 === 0 ? high : low,
    }));
    return {
      id: `r${round}-s${index}`,
      round,
      name: 'Conference Semifinals',
      conference: index % 2 === 0 ? 'east' : 'west',
      high,
      low,
      highSeed: index + 1,
      lowSeed: index + 5,
      games,
      winner: high,
      wins: games.filter((game) => game.winner === high).length,
      losses: games.filter((game) => game.winner === low).length,
    };
  });
}
