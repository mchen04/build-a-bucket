import { describe, expect, it } from 'vitest';
import { LEAGUE_TEAMS, simulateLeague, stageTotals, type HumanTeamInput, type LeagueResult } from '../src/shared/engine/league';
import {
  CPU_SPEEDUP,
  PLAYOFF_GAME_MS,
  REGULAR_BATCH_MS,
  REGULAR_BATCH_SIZE,
  checkpointAtFrom,
  clockFromLeague,
  isCheckpoint,
  isStageCheckpoint,
  limitPlayoffs,
  playoffRoundHeld,
  nextStageFrom,
  revealLeague,
  seasonEndsAt,
  stageCursorAtFrom,
  stageGamesTotal,
  stageTotal,
  type SeriesView,
  type LeagueClock,
} from '../src/shared/mp/league';

function humans(count = 8): HumanTeamInput[] {
  return LEAGUE_TEAMS.slice(0, count).map((team, index) => ({
    participantId: `p${index + 1}`,
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

function league(seed: string): LeagueResult {
  return simulateLeague({ seed, era: 'current', mode: 'normal', humans: humans() });
}

function revealedRegular(result: LeagueResult, stage: number, cursor: number): number {
  const totals = stageTotals(result.games);
  if (stage >= 4) return result.games.length;
  let revealed = 0;
  for (let index = 0; index < stage; index++) revealed += totals[index] ?? 0;
  return revealed + Math.min(cursor, totals[stage] ?? 0);
}

describe('spoiler-free reveal', () => {
  const result = league('reveal-walk');

  it('derives every field from games the cursor has revealed', () => {
    const ids = new Set(result.humans.map((entry) => entry.participantId));
    for (let stage = 0; stage <= 10; stage++) {
      const games = stageGamesTotal(result, stage);
      const cursors = [...new Set([0, Math.floor(games / 2), Math.max(0, games - 1), games, games + 5, stageTotal(result, stage)])];
      for (const cursor of cursors) {
        for (const me of [...result.humans.map((entry) => entry.participantId), null]) {
          const view = revealLeague(result, stage, cursor, me);
          const revealed = revealedRegular(result, stage, cursor);
          expect(JSON.stringify(view)).not.toContain('"participantId"');
          for (const id of ids) expect(JSON.stringify(view)).not.toContain(id);

          for (const game of view.games) expect(game.gameNo).toBeLessThanOrEqual(revealed);

          const standings = view.standings ?? [];
          const human = result.humans.find((entry) => entry.participantId === me) ?? null;
          if (stage < 4) {
            const records = new Map<string, { wins: number; losses: number }>();
            for (const row of [...result.standings.east, ...result.standings.west]) records.set(row.team, { wins: 0, losses: 0 });
            for (const game of result.games.slice(0, revealed)) {
              const home = records.get(game.home);
              const away = records.get(game.away);
              if (!home || !away) continue;
              if (game.winner === game.home) {
                home.wins += 1;
                away.losses += 1;
              } else {
                away.wins += 1;
                home.losses += 1;
              }
            }
            for (const row of standings) {
              expect(row.wins).toBe(records.get(row.team)?.wins ?? 0);
              expect(row.losses).toBe(records.get(row.team)?.losses ?? 0);
              expect(row.seed).toBeNull();
            }
          } else {
            const full = new Map([...result.standings.east, ...result.standings.west].map((row) => [row.team, row]));
            for (const row of standings) {
              const expected = full.get(row.team);
              expect(row.wins).toBe(expected?.wins ?? -1);
              expect(row.losses).toBe(expected?.losses ?? -1);
              expect(row.seed).toBe(expected?.seed ?? null);
            }
          }
          if (stage < 4) {
            expect(view.my?.seed ?? null).toBeNull();
            expect(view.my?.ppg ?? null).toBeNull();
          } else {
            expect(view.my?.seed ?? null).toBe(human?.seed ?? null);
            expect(view.my?.ppg ?? null).toBe(human?.ppg ?? null);
          }
          expect(view.my?.finish ?? null).toBe(stage >= 10 ? human?.finish ?? null : null);
          expect(view.awards === null).toBe(stage < 4);
          expect(view.playin === null).toBe(stage < 5);
          expect(view.playoffs === null).toBe(stage < 6);
          expect(view.recap === null).toBe(stage < 10);

          const mine = view.my;
          if (mine && stage < 4) {
            const row = standings.find((entry) => entry.team === mine.team);
            expect(mine.wins).toBe(row?.wins ?? 0);
            expect(mine.losses).toBe(row?.losses ?? 0);
            expect(mine.wins + mine.losses).toBeLessThanOrEqual(revealed);
            expect(mine.seed).toBeNull();
          }
          if (stage < 4) for (const row of standings) expect(row.seed).toBeNull();

          for (const series of view.playoffs ?? []) {
            expect(series.games.every((game) => game.index < series.games.length)).toBe(true);
            expect(series.wins).toBe(series.games.filter((game) => game.winner === series.high).length);
            expect(series.losses).toBe(series.games.filter((game) => game.winner === series.low).length);
            if (series.winner !== null) expect(series.complete).toBe(true);
          }

          expect(view.stageTotal).toBe(stageGamesTotal(result, stage));
          expect(view.checkpoint).toBe(isStageCheckpoint(clockFromLeague(result), stage, cursor));
          expect(isCheckpoint(cursor, stageGamesTotal(result, stage))).toBe(cursor >= stageGamesTotal(result, stage));
          expect(view.phase).toBe(stage <= 3 ? 'season' : stage === 4 ? 'awards' : stage === 5 ? 'playin' : stage <= 9 ? 'playoffs' : 'recap');
        }
      }
    }
  });

  it('reports the games actually played as the denominator', () => {
    const other = league('reveal-walk-two');
    for (let stage = 6; stage <= 9; stage++) {
      expect(stageTotal(result, stage)).toBe(stageGamesTotal(result, stage));
      expect(stageTotal(other, stage)).toBe(stageGamesTotal(other, stage));
      expect(stageTotal(result, stage)).toBeLessThanOrEqual(7 * (stage === 6 ? 8 : stage === 7 ? 4 : stage === 8 ? 2 : 1));
    }
    expect(stageTotal(result, 5)).toBe(stageGamesTotal(result, 5));
  });

  it('does not report a checkpoint before the last game of a playoff round is revealed', () => {
    for (let stage = 6; stage <= 9; stage++) {
      const games = stageGamesTotal(result, stage);
      expect(isCheckpoint(Math.max(0, games - 1), games)).toBe(false);
      expect(isCheckpoint(games, games)).toBe(true);
    }
  });
});

describe('reveal pacing', () => {
  const OLD_SEASON_MS = Math.ceil(1230 / REGULAR_BATCH_SIZE) * REGULAR_BATCH_MS;
  const solo = simulateLeague({ seed: 'pace', era: 'current', mode: 'normal', humans: humans(1) });
  const human = solo.humans[0]!.team;
  const clock = clockFromLeague(solo);

  it('runs the whole regular season as one stage that ends the season', () => {
    expect(clock.counts).toEqual([1230, 0, 0, 0]);
    expect(seasonEndsAt(clock.counts, 0)).toBe(true);
    expect(nextStageFrom(clock.counts, 0)).toBe(4);
    expect(nextStageFrom([300, 300, 300, 330], 0)).toBe(4);
  });

  it('gives each round with a human game the fast pace and resolves the rest quickly', () => {
    const rounds = new Map<number, boolean>();
    for (const game of solo.games) {
      rounds.set(game.round, (rounds.get(game.round) ?? false) || game.home === human || game.away === human);
    }
    const slow = [...rounds.values()].filter(Boolean).length;
    expect(slow).toBe(82);
    expect(slow).toBeGreaterThan(0);
    expect(checkpointAtFrom(clock, 0, 0)).toBeGreaterThan(0);
    expect(checkpointAtFrom(clock, 0, 0)! * 10).toBeLessThan(OLD_SEASON_MS);
  });

  it('reveals the season in order, never backwards, and finishes at the checkpoint', () => {
    const end = checkpointAtFrom(clock, 0, 0)!;
    let last = 0;
    for (let at = 0; at <= end; at += 97) {
      const cursor = stageCursorAtFrom(clock, 0, 0, at);
      expect(cursor).toBeGreaterThanOrEqual(last);
      last = cursor;
    }
    expect(stageCursorAtFrom(clock, 0, 0, end - 1)).toBeLessThan(1230);
    expect(stageCursorAtFrom(clock, 0, 0, end)).toBe(1230);
  });

  it('resolves computer-only playoff games quickly', () => {
    for (let stage = 6; stage <= 9; stage++) {
      const series = solo.series.filter((entry) => entry.round === stage - 5);
      const expected = series.reduce((sum, entry) => {
        const each = entry.high === human || entry.low === human ? PLAYOFF_GAME_MS : CPU_SPEEDUP;
        return sum + each * entry.games.length;
      }, 0);
      expect(checkpointAtFrom(clock, stage, 0)).toBe(stage === 6 ? 0 : Math.ceil(expected));
    }
  });

  it('starts round one at zero and paces the first game', () => {
    expect(stageCursorAtFrom(clock, 6, 1000, 1000)).toBe(0);
    expect(stageCursorAtFrom(clock, 6, 1000, 1001)).toBeLessThanOrEqual(1);
  });

  it('keeps the gate closed after round one starts in the fallback view', () => {
    const view = revealLeague(solo, 6, 0, solo.humans[0]!.participantId, Date.now());
    expect(view.checkpoint).toBe(false);
  });

  it('advances a human series score with the cursor', () => {
    const many = simulateLeague({ seed: 'pace', era: 'current', mode: 'normal', humans: humans(8) });
    const human = many.humans.find((entry) =>
      many.series.some((series) => series.round === 1 && (series.high === entry.team || series.low === entry.team)),
    );
    expect(human).toBeTruthy();
    if (!human) return;
    const series = many.series.find((entry) => entry.round === 1 && (entry.high === human.team || entry.low === human.team));
    expect(series).toBeTruthy();
    if (!series) return;
    const scores: number[] = [];
    for (let cursor = 0; cursor <= stageGamesTotal(many, 6); cursor++) {
      const view = revealLeague(many, 6, cursor, human.participantId);
      const current = view.playoffs?.find((entry) => entry.id === series.id);
      if (current) scores.push(current.wins + current.losses);
    }
    expect(new Set(scores).size).toBeGreaterThan(1);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });

  it('limits revealed playoff games one at a time without anticipating the winner', () => {
    const series: SeriesView = {
      id: 's1',
      round: 1,
      name: 'First Round',
      conference: 'east',
      high: 'BOS',
      low: 'NYK',
      highSeed: 1,
      lowSeed: 8,
      games: [
        { index: 0, home: 'BOS', away: 'NYK', homeScore: 100, awayScore: 90, winner: 'BOS' },
        { index: 1, home: 'NYK', away: 'BOS', homeScore: 100, awayScore: 90, winner: 'NYK' },
        { index: 2, home: 'BOS', away: 'NYK', homeScore: 90, awayScore: 100, winner: 'NYK' },
        { index: 3, home: 'NYK', away: 'BOS', homeScore: 100, awayScore: 90, winner: 'NYK' },
      ],
      winner: 'NYK',
      wins: 1,
      losses: 3,
      complete: true,
    };
    const first = limitPlayoffs([series], 1)?.[0];
    expect(first?.games).toHaveLength(1);
    expect(first?.wins).toBe(1);
    expect(first?.losses).toBe(0);
    expect(first?.winner).toBeNull();
    expect(first?.complete).toBe(false);
    const last = limitPlayoffs([series], 4)?.[0];
    expect(last?.wins).toBe(1);
    expect(last?.losses).toBe(3);
    expect(last?.winner).toBe('NYK');
    expect(last?.complete).toBe(true);
  });

  it('holds every playoff round with a human series for one game step', () => {
    const clock = {
      counts: [0, 0, 0, 0],
      playin: 0,
      seriesCounts: [1, 1, 1, 1],
      seriesGames: [7, 7, 7, 7],
      units: [[], [], [], [], [], [1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1]],
      humanSeasons: [{ participantId: 'p1', name: 'Me', team: 'BOS', wins: 50, losses: 32, seed: 1 }],
      series: [1, 2, 3, 4].map((round) => ({ round, name: `Round ${round}`, conference: 'east' as const, high: 'BOS', low: 'NYK', winner: 'BOS', wins: 4, losses: 3 })),
    } as unknown as LeagueClock;
    const total = 7 * 700;
    for (const stage of [6, 7, 8, 9]) {
      expect(playoffRoundHeld(clock, stage, 0, total)).toBe(true);
      expect(playoffRoundHeld(clock, stage, 0, total + 700)).toBe(false);
    }
  });

  it('keeps the old pace for a saved clock without pacing units', () => {
    const saved = { counts: [300, 310, 300, 320], playin: 6, seriesCounts: [8, 4, 2, 1], seriesGames: [40, 22, 11, 6] };
    expect(stageCursorAtFrom(saved, 0, 0, REGULAR_BATCH_MS)).toBe(REGULAR_BATCH_SIZE);
    expect(stageCursorAtFrom(saved, 7, 0, PLAYOFF_GAME_MS * 2)).toBe(2);
    expect(nextStageFrom(saved.counts, 0)).toBe(4);
  });
});
