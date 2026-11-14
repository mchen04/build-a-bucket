import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Catalog } from '../../shared/data/loader';
import { computeOvr } from '../../shared/engine/ovr';
import { SQUAD_SLOTS } from '../../shared/engine/squad';
import type { Era } from '../../shared/engine/types';
import type { SquadPlayerBuild } from '../../shared/mp/types';
import { createRun, isBuildComplete, type RunState } from '../../shared/run';
import { TopBar } from '../components';
import { Builder } from './Builder';

interface Props {
  catalog: Catalog;
  era: Era;
  team: string | null;
  buildSeed: string;
  busy: boolean;
  header?: ComponentChildren;
  onBack: () => void;
  onSubmit: (players: SquadPlayerBuild[]) => void;
}

export function LobbySquad(props: Props) {
  const [slot, setSlot] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, RunState | null>>(() =>
    Object.fromEntries(SQUAD_SLOTS.map((entry) => [entry.id, null])),
  );

  const activeSlot = SQUAD_SLOTS.find((entry) => entry.id === slot) ?? null;
  const activeRun = slot ? runs[slot] ?? null : null;
  const players: (SquadPlayerBuild | null)[] = SQUAD_SLOTS.map((entry) => {
    const run = runs[entry.id];
    return run && isBuildComplete(run)
      ? { slot: entry.id, position: run.position, picks: run.picks, spins: run.history }
      : null;
  });
  const complete = players.every((entry) => entry !== null);

  if (activeSlot && activeRun) {
    return (
      <Builder
        run={activeRun}
        catalog={props.catalog}
        header={props.header}
        onChange={(next) => setRuns((current) => ({ ...current, [activeSlot.id]: next }))}
        onBack={() => setSlot(null)}
        completeLabel={`Save ${activeSlot.label}`}
        onComplete={() => setSlot(null)}
      />
    );
  }

  const openSlot = (slotId: string) => {
    const entry = SQUAD_SLOTS.find((candidate) => candidate.id === slotId);
    if (!entry) return;
    if (!runs[slotId]) {
      setRuns((current) => ({ ...current, [slotId]: createRun(`${props.buildSeed}:${slotId}`, entry.pos, props.era) }));
    }
    setSlot(slotId);
  };

  return (
    <div class="screen">
      <TopBar title="Squad" onBack={props.onBack} right={<span class="pill">{props.team ?? 'Lineup'}</span>} />
      {props.header}
      <div class="body">
        <div class="card">
          <div class="tiny muted">Starting five</div>
          <div style={{ fontWeight: 800, fontSize: '13px' }}>
            {props.team ? `Your five replace the ${props.team} starters` : 'Your five become the starting lineup'}
          </div>
        </div>
        {SQUAD_SLOTS.map((entry) => {
          const run = runs[entry.id];
          const ready = run ? isBuildComplete(run) : false;
          const ovr = run ? computeOvr(run.picks, run.position) : 0;
          return (
            <button class="home-item" key={entry.id} data-testid={`lobby-squad-slot-${entry.id}`} onClick={() => openSlot(entry.id)}>
              <span style={{ flex: 1, textAlign: 'left' }}>
                <span class="name">
                  {entry.label} · {entry.pos === 'guard' ? 'Guard' : 'Big'}
                </span>
                <span class="sub">{ready ? `OVR ${ovr} · locked` : run ? `${Object.keys(run.picks).length}/10 traits` : 'Empty slot'}</span>
              </span>
              <span class="chev">{ready ? '✓' : '›'}</span>
            </button>
          );
        })}
      </div>
      <div class="bottom">
        <button
          class="btn"
          data-testid="lobby-squad-submit"
          disabled={!complete || props.busy}
          onClick={() => props.onSubmit(players.filter((entry): entry is SquadPlayerBuild => entry !== null))}
        >
          {props.busy ? 'Submitting…' : complete ? 'Submit lineup' : `Fill ${players.filter(Boolean).length}/5 slots`}
        </button>
      </div>
    </div>
  );
}
