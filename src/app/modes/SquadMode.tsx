import { useState } from 'preact/hooks';
import type { Catalog } from '../../shared/data/loader';
import { mulberry32, randomSeed } from '../../shared/engine/rng';
import { rollStats } from '../../shared/engine/season';
import { honorsFor, squadSeason, squadStarters, squadStrength } from '../../shared/engine/squad';
import { newSquadState, readSquad, saveSquad, type SquadState } from '../../shared/squadStore';
import { createRun } from '../../shared/run';
import { Builder } from '../screens/Builder';
import { Squad, type SquadOutcome } from '../screens/Squad';

interface Props {
  catalog: Catalog;
  onExit: () => void;
}

export function SquadMode({ catalog, onExit }: Props) {
  const [boot] = useState(() => {
    const saved = readSquad();
    const state = saved ?? newSquadState(randomSeed());
    if (!saved) saveSquad(state);
    return { state, outcome: (state.result as SquadOutcome | null) ?? null };
  });
  const [squad, setSquad] = useState<SquadState>(boot.state);
  const [slot, setSlot] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SquadOutcome | null>(boot.outcome);

  const put = (next: SquadState) => {
    saveSquad(next);
    setSquad(next);
  };

  const buildSlot = (slotId: string) => {
    const entry = squad.slots.find((item) => item.id === slotId);
    if (!entry) return;
    put({ ...squad, slots: squad.slots.map((item) => (item.id === slotId ? { ...item, run: createRun(randomSeed(), entry.pos, 'current') } : item)), result: null });
    setOutcome(null);
    setSlot(slotId);
  };

  const commitSlot = (next: ReturnType<typeof createRun>) => {
    if (!slot) return;
    put({ ...squad, slots: squad.slots.map((item) => (item.id === slot ? { ...item, run: next } : item)) });
  };

  const closeSlot = (keep: boolean) => {
    if (!keep && slot) {
      put({ ...squad, slots: squad.slots.map((item) => (item.id === slot ? { ...item, run: null } : item)) });
    }
    setSlot(null);
  };

  const dropSlot = (slotId: string) => {
    put({ ...squad, slots: squad.slots.map((item) => (item.id === slotId ? { ...item, run: null } : item)), result: null });
    setOutcome(null);
  };

  const simulate = () => {
    if (!squad.team) return;
    const built = squad.slots.filter((entry) => entry.run);
    const builds = built.map((entry) => ({
      pos: entry.pos,
      values: Object.fromEntries(Object.entries(entry.run?.picks ?? {}).map(([attr, pick]) => [attr, pick.val])),
    }));
    const starters = squadStarters(squad.team, catalog.currentGuards, catalog.currentBigs);
    const strength = squadStrength(squad.team, starters, builds);
    const seasonNumber = squad.season + 1;
    const season = squadSeason(`${squad.seed}-season-${seasonNumber}`, squad.team, strength);
    const lines = built.map((entry, index) => {
      const rolled = rollStats(builds[index]?.values ?? {}, entry.pos, mulberry32(0));
      return { id: entry.id, ppg: rolled.ppg, rpg: rolled.rpg, apg: rolled.apg, spg: rolled.spg, bpg: rolled.bpg };
    });
    const result: SquadOutcome = { strength, season, honors: honorsFor(lines, season.wins), lines };
    put({ ...squad, season: seasonNumber, result });
    setOutcome(result);
  };

  if (slot) {
    const entry = squad.slots.find((item) => item.id === slot);
    if (entry?.run) {
      return (
        <Builder
          run={entry.run}
          catalog={catalog}
          onChange={commitSlot}
          onBack={() => closeSlot(false)}
          completeLabel="Add to squad"
          onComplete={() => closeSlot(true)}
          header={
            <div class="daily-strip" data-testid="squad-strip">
              <span class="ticker-dot" />
              <span class="tiny">SQUAD · {entry.id} · {entry.pos.toUpperCase()}</span>
            </div>
          }
        />
      );
    }
  }

  return (
    <Squad
      squad={squad}
      catalog={catalog}
      starters={squad.team ? squadStarters(squad.team, catalog.currentGuards, catalog.currentBigs) : []}
      outcome={outcome}
      onBuildSlot={buildSlot}
      onDropSlot={dropSlot}
      onPickTeam={(team) => put({ ...squad, team })}
      onSimulate={simulate}
      onReset={() => {
        const fresh = newSquadState(randomSeed());
        put(fresh);
        setOutcome(null);
      }}
      onExit={onExit}
    />
  );
}
