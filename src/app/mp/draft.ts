import type { BuildDraft } from '../../shared/mp/types';
import { createRun, type RunState } from '../../shared/run';

export function runFromDraft(draft: BuildDraft, seed: string): RunState {
  return {
    ...createRun(seed, draft.position, draft.era),
    picks: draft.picks,
    spinIndex: draft.spinIndex,
    teamRespinUsed: draft.teamRespinUsed,
    playerRespinUsed: draft.playerRespinUsed,
    current: draft.current,
    team: draft.team,
  };
}

export function latestPick(run: RunState): { attr: string; playerName: string } | null {
  const entries = Object.entries(run.picks);
  const last = entries[entries.length - 1];
  return last ? { attr: last[0], playerName: last[1].playerName } : null;
}

export function draftFromRun(run: RunState, latest: { attr: string; playerName: string } | null): BuildDraft {
  return {
    position: run.position,
    era: run.era,
    picks: run.picks,
    spinIndex: run.spinIndex,
    teamRespinUsed: run.teamRespinUsed,
    playerRespinUsed: run.playerRespinUsed,
    current: run.current,
    team: run.team,
    latest: latest ?? latestPick(run),
  };
}
