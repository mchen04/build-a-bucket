import type { Era, Pick, Player, Position, SeasonResult } from './engine/types';

export type Screen = 'builder' | 'team' | 'season' | 'playoffs' | 'end';

export interface RunState {
  v: 1;
  seed: string;
  position: Position;
  era: Era;
  picks: Record<string, Pick>;
  spinIndex: number;
  teamRespinUsed: boolean;
  playerRespinUsed: boolean;
  current: { team: string; playerName: string } | null;
  team: string | null;
  season: SeasonResult | null;
  screen: Screen;
}

export function createRun(seed: string, position: Position, era: Era): RunState {
  return {
    v: 1,
    seed,
    position,
    era,
    picks: {},
    spinIndex: 0,
    teamRespinUsed: false,
    playerRespinUsed: false,
    current: null,
    team: null,
    season: null,
    screen: 'builder',
  };
}

export function respinSeedFor(run: RunState): string {
  return `${run.seed}:r`;
}

export function pickFromPlayer(player: Player, attr: string): Pick {
  return {
    attr,
    val: player.attrs[attr] ?? 0,
    playerName: player.name,
    playerShort: player.short,
    team: player.team,
    number: player.number,
  };
}

export function placePick(run: RunState, player: Player, attr: string): RunState {
  if (run.picks[attr]) return run;
  const picks = { ...run.picks, [attr]: pickFromPlayer(player, attr) };
  return {
    ...run,
    picks,
    current: null,
    spinIndex: run.spinIndex + 1,
  };
}

export function isBuildComplete(run: RunState): boolean {
  return Object.keys(run.picks).length >= 10;
}

export function suppliedTeams(run: RunState): string[] {
  return [...new Set(Object.values(run.picks).map((pick) => pick.team))].sort((a, b) => a.localeCompare(b));
}
