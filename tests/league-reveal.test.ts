import { describe, expect, it } from 'vitest';
import { LEAGUE_TEAMS, simulateLeague, stageTotals, type HumanTeamInput, type LeagueResult } from '../src/shared/engine/league';
import { isCheckpoint, revealLeague, stageGamesTotal, stageTotal } from '../src/shared/mp/league';

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

          expect(view.stageTotal).toBe(stageTotal(result, stage));
          expect(view.stageTotal).toBeGreaterThanOrEqual(stageGamesTotal(result, stage));
          expect(view.checkpoint).toBe(cursor >= stageGamesTotal(result, stage));
          expect(isCheckpoint(cursor, stageGamesTotal(result, stage))).toBe(cursor >= stageGamesTotal(result, stage));
          expect(view.phase).toBe(stage <= 3 ? 'season' : stage === 4 ? 'awards' : stage === 5 ? 'playin' : stage <= 9 ? 'playoffs' : 'recap');
        }
      }
    }
  });

  it('reports the same denominator for every seed, so series length cannot leak', () => {
    const other = league('reveal-walk-two');
    for (let stage = 6; stage <= 9; stage++) {
      expect(stageTotal(other, stage)).toBe(stageTotal(result, stage));
      expect(stageTotal(result, stage)).toBe([56, 28, 14, 7][stage - 6]);
      expect(stageGamesTotal(result, stage)).toBeLessThanOrEqual(stageTotal(result, stage));
    }
    expect(stageTotal(result, 5)).toBe(6);
  });

  it('does not report a checkpoint before the last game of a playoff round is revealed', () => {
    for (let stage = 6; stage <= 9; stage++) {
      const games = stageGamesTotal(result, stage);
      expect(isCheckpoint(Math.max(0, games - 1), games)).toBe(false);
      expect(isCheckpoint(games, games)).toBe(true);
    }
  });
});
