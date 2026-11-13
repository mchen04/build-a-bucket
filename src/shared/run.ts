import { ATTR_LABELS, BIG_ATTRS, GUARD_ATTRS } from './engine/rules';
import type { SeasonDraft } from './engine/season';
import type { Era, MomentCard, Pick, Player, Position, SeasonResult } from './engine/types';

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
  draft: SeasonDraft | null;
  moment: MomentCard | null;
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
    draft: null,
    moment: null,
    screen: 'builder',
  };
}

export function respinSeedFor(run: RunState): string {
  return `${run.seed}:r`;
}

export interface PickOption {
  attr: string;
  label: string;
  short: string;
  val: number;
  filled: boolean;
}

export function pickOptions(run: RunState, player: Player): PickOption[] {
  const keys: readonly string[] = run.position === 'guard' ? GUARD_ATTRS : BIG_ATTRS;
  return keys
    .filter((attr) => player.attrs[attr] !== undefined)
    .map((attr) => ({
      attr,
      label: ATTR_LABELS[attr]?.label ?? attr,
      short: ATTR_LABELS[attr]?.short ?? attr,
      val: player.attrs[attr] ?? 0,
      filled: Boolean(run.picks[attr]),
    }));
}

export function openOptions(options: readonly PickOption[]): PickOption[] {
  return options.filter((option) => !option.filled);
}

export function heightWeightFor(run: RunState): { height: number | null; weight: number | null } {
  const size = run.picks.size;
  return { height: size?.height ?? null, weight: size?.weight ?? null };
}

export function pickFromPlayer(player: Player, attr: string, photo?: string): Pick {
  return {
    attr,
    val: player.attrs[attr] ?? 0,
    playerName: player.name,
    playerShort: player.short,
    team: player.team,
    number: player.number,
    photo,
    height: player.height,
    weight: player.weight,
  };
}

export function placePick(run: RunState, player: Player, attr: string, photo?: string): RunState {
  if (run.picks[attr]) return run;
  const picks = { ...run.picks, [attr]: pickFromPlayer(player, attr, photo) };
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
