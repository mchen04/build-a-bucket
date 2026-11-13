import type { Catalog } from '../../shared/data/loader';
import { SQUAD_SLOTS, type SquadSeasonResult, type SquadStarter, type SquadStrength } from '../../shared/engine/squad';
import { ovrFromValues } from '../../shared/engine/ovr';
import type { SquadState } from '../../shared/squadStore';
import { StatGrid, TopBar } from '../components';

export interface SquadOutcome {
  strength: SquadStrength;
  season: SquadSeasonResult;
  honors: Record<string, string>;
  lines: { id: string; ppg: number; rpg: number; apg: number }[];
}

interface Props {
  squad: SquadState;
  catalog: Catalog;
  starters: SquadStarter[];
  outcome: SquadOutcome | null;
  onBuildSlot: (slotId: string) => void;
  onDropSlot: (slotId: string) => void;
  onPickTeam: (team: string) => void;
  onSimulate: () => void;
  onReset: () => void;
  onExit: () => void;
}

function valuesOf(run: NonNullable<SquadState['slots'][number]['run']>): Record<string, number> {
  return Object.fromEntries(Object.entries(run.picks).map(([attr, pick]) => [attr, pick.val]));
}

export function Squad(props: Props) {
  const { squad } = props;
  const built = squad.slots.filter((slot) => slot.run);
  const allBuilt = built.length === SQUAD_SLOTS.length;
  const team = squad.team;
  return (
    <div class="screen">
      <TopBar title="Squad Builder" onBack={props.onExit} right={<span class="tiny muted">{built.length}/5</span>} />
      <div class="body">
        <div class="sq-slots" data-testid="squad-slots">
          {squad.slots.map((slot) => {
            const run = slot.run;
            const values = run ? valuesOf(run) : null;
            const ovr = values ? ovrFromValues(values, slot.pos) : null;
            const blast = run ? Object.values(run.picks).sort((a, b) => b.val - a.val)[0] : null;
            return (
              <div class={`sq-slot${run ? ' filled' : ''}`} key={slot.id} data-testid={`squad-slot-${slot.id}`}>
                <span class="sq-pos">{slot.id}</span>
                <span class="sq-who">
                  {run ? (
                    <>
                      <b>{ovr} OVR</b>
                      <small>{blast?.playerName ?? 'Build'} · {slot.pos}</small>
                    </>
                  ) : (
                    <>
                      <b>Empty</b>
                      <small>Build a {slot.pos}</small>
                    </>
                  )}
                </span>
                {run ? (
                  <button class="sq-action" onClick={() => props.onDropSlot(slot.id)}>
                    Redo
                  </button>
                ) : (
                  <button class="sq-action" data-testid={`squad-build-${slot.id}`} onClick={() => props.onBuildSlot(slot.id)}>
                    Build
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {allBuilt && !team ? (
          <div class="card" data-testid="squad-team">
            <div class="tiny muted">PICK THE TEAM</div>
            <div class="teams" style={{ marginTop: '6px' }}>
              {props.catalog.teams.map((entry) => (
                <button class="team-btn" key={entry.short} aria-pressed={false} onClick={() => props.onPickTeam(entry.short)}>
                  {entry.short}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {team ? (
          <div class="card" data-testid="squad-ready">
            <div class="tiny muted">{team} · starting five</div>
            <StatGrid
              className="five"
              items={props.starters.map((starter) => ({ label: starter.pos.toUpperCase(), value: starter.ovr }))}
            />
          </div>
        ) : null}
        {props.outcome ? (
          <div class="card" data-testid="squad-result">
            <div class="tiny muted">SEASON {squad.season}</div>
            <div class="title" style={{ marginTop: '2px' }}>
              {props.outcome.season.wins}-{props.outcome.season.losses} · SEED {props.outcome.season.seedNumber}
            </div>
            <StatGrid
              items={[
                { label: 'Record', value: `${props.outcome.season.wins}-${props.outcome.season.losses}` },
                { label: 'Seed', value: `#${props.outcome.season.seedNumber}` },
                { label: 'OFF', value: props.outcome.strength.off },
                { label: 'DEF', value: props.outcome.strength.def },
              ]}
            />
            <div class="result-line">
              {props.outcome.season.champion ? 'Champions' : props.outcome.season.madePlayoffs ? 'Playoffs' : 'Missed playoffs'}
            </div>
            <div class="stat-rows">
              {props.outcome.lines.map((line) => (
                <div class="stat-row" key={line.id}>
                  <span class="stat-row-pos">{line.id}</span>
                  <span class="stat-row-main">{line.ppg.toFixed(1)} PPG</span>
                  <span class="stat-row-sub">
                    {line.rpg.toFixed(1)} RPG · {line.apg.toFixed(1)} APG
                  </span>
                  {props.outcome?.honors[line.id] ? <span class="stat-row-honor">{props.outcome.honors[line.id]}</span> : null}
                </div>
              ))}
            </div>
            <button class="btn btn-ghost btn-small" data-testid="squad-new" style={{ marginTop: '6px' }} onClick={props.onReset}>
              New squad
            </button>
          </div>
        ) : null}
        {!allBuilt ? (
          <div class="notice" data-testid="squad-hint">
            Three guards, two bigs.
          </div>
        ) : null}
      </div>
      <div class="bottom">
        {props.outcome ? (
          <button class="btn" data-testid="squad-again" onClick={props.onSimulate}>
            Run it back
          </button>
        ) : team ? (
          <button class="btn" data-testid="squad-simulate" onClick={props.onSimulate}>
            Simulate season
          </button>
        ) : (
          <button class="btn" disabled>
            {allBuilt ? 'Pick a team' : `Fill ${SQUAD_SLOTS.length - built.length} more slot${SQUAD_SLOTS.length - built.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
    </div>
  );
}
