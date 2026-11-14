import { useEffect, useState } from 'preact/hooks';
import type { Catalog } from '../../shared/data/loader';
import { SQUAD_SLOTS, type SquadSeasonResult, type SquadStrength } from '../../shared/engine/squad';
import { ovrFromValues } from '../../shared/engine/ovr';
import type { SquadState, SquadStage } from '../../shared/squadStore';
import { StatGrid, StandingsTable, TopBar } from '../components';
import { squadFinish, squadFinishDetail, squadFinishVisible, squadRoundLabel, squadRoundResult } from '../mp/squadResult';

export interface SquadOutcome {
  strength: SquadStrength;
  season: SquadSeasonResult;
  honors: Record<string, string>;
  lines: { id: string; ppg: number; rpg: number; apg: number; spg?: number; bpg?: number }[];
}

interface Props {
  squad: SquadState;
  catalog: Catalog;
  stage: SquadStage;
  preview: SquadStrength | null;
  outcome: SquadOutcome | null;
  onBuildSlot: (slotId: string) => void;
  onDropSlot: (slotId: string) => void;
  onPickTeam: (team: string) => void;
  onReview: () => void;
  onStartSeason: () => void;
  onSeasonDone: () => void;
  onStandingsDone: () => void;
  onPlayoffsDone: () => void;
  onBackToBuild: () => void;
  onAnotherSeason: () => void;
  onReset: () => void;
  onExit: () => void;
}

function valuesOf(run: NonNullable<SquadState['slots'][number]['run']>): Record<string, number> {
  return Object.fromEntries(Object.entries(run.picks).map(([attr, pick]) => [attr, pick.val]));
}

function buildInfo(slot: SquadState['slots'][number]) {
  const run = slot.run;
  const values = run ? valuesOf(run) : null;
  const ovr = values ? ovrFromValues(values, slot.pos) : null;
  const blast = run ? Object.values(run.picks).sort((a, b) => b.val - a.val)[0] : null;
  return { id: slot.id, pos: slot.pos, ovr, player: blast?.playerName ?? 'Build' };
}

function PlayerRows(props: { lines: SquadOutcome['lines']; honors: Record<string, string> }) {
  return (
    <div class="stat-rows">
      {props.lines.map((line) => (
        <div class="stat-row" key={line.id}>
          <span class="stat-row-pos">{line.id}</span>
          <span class="stat-row-main">
            {line.ppg.toFixed(1)} PPG
            {props.honors[line.id] ? <span class="stat-row-honor">{props.honors[line.id]}</span> : null}
          </span>
          <span class="stat-row-sub">
            {line.rpg.toFixed(1)} RPG · {line.apg.toFixed(1)} APG
            {line.spg !== undefined ? ` · ${line.spg.toFixed(1)} SPG` : ''}
            {line.bpg !== undefined ? ` · ${line.bpg.toFixed(1)} BPG` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

const STAGE_TITLE: Record<SquadStage, string> = {
  build: 'Squad Builder',
  review: 'Strengths',
  season: 'Season',
  standings: 'Standings',
  playoffs: 'Playoffs',
  recap: 'Recap',
};

export function Squad(props: Props) {
  const { squad } = props;
  const built = squad.slots.filter((slot) => slot.run);
  const allBuilt = built.length === SQUAD_SLOTS.length;
  const team = squad.team;
  const lineup = squad.slots.map(buildInfo);
  const season = props.outcome?.season ?? null;
  const rounds = season?.rounds ?? [];
  const log = season?.log ?? '';
  const [played, setPlayed] = useState(0);
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    if (props.stage !== 'season' || !season) return;
    setPlayed(0);
    const id = window.setInterval(() => setPlayed((value) => Math.min(season.log.length, value + 1)), 28);
    return () => window.clearInterval(id);
  }, [props.stage, season]);

  useEffect(() => {
    if (props.stage !== 'playoffs' || !season) return;
    setRevealed(0);
    const id = window.setInterval(() => setRevealed((value) => Math.min(season.rounds.length, value + 1)), 520);
    return () => window.clearInterval(id);
  }, [props.stage, season]);

  const seasonWins = log.slice(0, played).split('').filter((mark) => mark === 'W').length;
  const seasonLosses = played - seasonWins;
  const recent = log.slice(Math.max(0, played - 10), played).split('');
  const seasonDone = played >= log.length;
  const finishShown = season ? squadFinishVisible('playoffs', revealed, rounds) : false;
  const standings = season?.standings ?? [];
  const stageRight =
    props.stage === 'build'
      ? `${built.length}/5`
      : props.stage === 'season'
        ? `${played}/${log.length || 82}`
        : props.stage === 'playoffs'
          ? `SEED #${season?.seedNumber ?? '—'}`
          : '';

  const slots = (
    <div class="sq-slots" data-testid="squad-slots">
      {squad.slots.map((slot, index) => {
        const info = lineup[index]!;
        return (
          <div class={`sq-slot${slot.run ? ' filled' : ''}`} key={slot.id} data-testid={`squad-slot-${slot.id}`}>
            <span class="sq-pos">{slot.id}</span>
            <span class="sq-who">
              {slot.run ? (
                <>
                  <b>{info.ovr} OVR</b>
                  <small>{info.player} · {slot.pos}</small>
                </>
              ) : (
                <>
                  <b>Empty</b>
                  <small>Build a {slot.pos}</small>
                </>
              )}
            </span>
            {slot.run ? (
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
  );

  return (
    <div class="screen">
      <TopBar title={STAGE_TITLE[props.stage]} onBack={props.onExit} right={<span class="tiny muted" data-testid="squad-stage">{stageRight}</span>} />
      <div class="body" data-testid={`squad-${props.stage}`}>
        {props.stage === 'build' ? (
          <>
            {slots}
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
            {!allBuilt ? (
              <div class="notice" data-testid="squad-hint">
                Three guards, two bigs.
              </div>
            ) : null}
          </>
        ) : null}

        {props.stage === 'review' ? (
          <>
            {slots}
            <div class="card" data-testid="squad-ready">
              <div class="tiny muted">{team} · strengths</div>
              <StatGrid
                items={[
                  { label: 'OFF', value: props.preview?.off ?? '—' },
                  { label: 'DEF', value: props.preview?.def ?? '—' },
                ]}
              />
              <div class="tiny muted" style={{ marginTop: 'var(--space-2)' }}>
                Starting five
              </div>
              <div class="lineup" data-testid="squad-lineup">
                {lineup.map((entry) => (
                  <div class="lineup-row" key={entry.id}>
                    <span class="lineup-pos">{entry.id}</span>
                    <span class="lineup-name">{entry.player}</span>
                    <span class="lineup-ovr">{entry.ovr}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {props.stage === 'season' && season ? (
          <>
            <div class="row" style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <div class="tiny muted">Record</div>
                <div style={{ fontSize: '26px', fontWeight: 900 }}>
                  {seasonWins}-{seasonLosses}
                </div>
              </div>
            </div>
            <div class="recent">
              {recent.map((mark, index) => (
                <span class={`pill ${mark === 'W' ? 'win' : 'loss'}`} key={index}>
                  {mark}
                </span>
              ))}
            </div>
            <div class="card">
              <div class="tiny muted">Season journey</div>
              <div class="season-run">
                {log
                  .slice(0, played)
                  .split('')
                  .map((mark, index) => (
                    <span class={`season-mark ${mark === 'W' ? 'win' : 'loss'}`} key={index}>
                      {mark}
                    </span>
                  ))}
              </div>
            </div>
            {!seasonDone ? <div class="tiny muted">Tracking the season.</div> : null}
          </>
        ) : null}

        {props.stage === 'standings' && season ? (
          <>
            <StatGrid
              items={[
                { label: 'Record', value: `${season.wins}-${season.losses}` },
                { label: 'Seed', value: `#${season.seedNumber}` },
                { label: 'OFF', value: props.outcome?.strength.off ?? '—' },
                { label: 'DEF', value: props.outcome?.strength.def ?? '—' },
              ]}
            />
            <StandingsTable
              rows={standings.map((row, index) => ({
                key: row.short,
                seed: index + 1,
                team: row.short,
                wins: row.wins,
                losses: row.losses,
                isMine: row.isUs,
              }))}
              showSeed
              showLosses
              showGB
              compact
            />
            <div class="card" data-testid="squad-awards">
              <div class="tiny muted">Awards</div>
              <PlayerRows lines={props.outcome?.lines ?? []} honors={props.outcome?.honors ?? {}} />
            </div>
          </>
        ) : null}

        {props.stage === 'playoffs' && season ? (
          <>
            <div class="bracket" data-testid="squad-playoff-rounds">
              {rounds.slice(0, revealed).map((round, index) => (
                <div class="round fade-in" key={index}>
                  <span class="rname">{squadRoundLabel(round)}</span>
                  <span class="ropp">{round.opponent ?? '—'}</span>
                  <span class={`rres ${round.won ? 'win' : 'loss'}`}>{squadRoundResult(round)}</span>
                </div>
              ))}
              {rounds.length === 0 ? (
                <div class="card center muted" style={{ fontSize: '12px' }}>
                  No playoff games. The season ended early.
                </div>
              ) : null}
            </div>
            {finishShown ? (
              <div class={`banner ${season.champion ? '' : 'miss'}`} data-testid="squad-playoff-banner">
                <h1>{season.champion ? 'NBA CHAMPIONS!' : season.madePlayoffs ? 'SEASON OVER' : 'ELIMINATED'}</h1>
                <p>{squadFinishDetail(season)}</p>
              </div>
            ) : (
              <p class="tiny muted center" style={{ margin: 0 }}>
                Revealing…
              </p>
            )}
          </>
        ) : null}

        {props.stage === 'recap' && season ? (
          <>
            <div class="card" data-testid="squad-result">
              <div class="tiny muted">SEASON {squad.season}</div>
              <div class="title" style={{ marginTop: '2px' }}>
                {season.wins}-{season.losses} · SEED {season.seedNumber}
              </div>
              <StatGrid
                items={[
                  { label: 'Record', value: `${season.wins}-${season.losses}` },
                  { label: 'Seed', value: `#${season.seedNumber}` },
                  { label: 'OFF', value: props.outcome?.strength.off ?? '—' },
                  { label: 'DEF', value: props.outcome?.strength.def ?? '—' },
                ]}
              />
              <div class="result-line">{squadFinish(season)}</div>
              <StandingsTable
                rows={standings.map((row, index) => ({
                  key: row.short,
                  seed: index + 1,
                  team: row.short,
                  wins: row.wins,
                  losses: row.losses,
                  isMine: row.isUs,
                }))}
                showSeed
                showLosses
                showGB
                compact
              />
              <PlayerRows lines={props.outcome?.lines ?? []} honors={props.outcome?.honors ?? {}} />
              {rounds.length ? (
                <div class="bracket" data-testid="squad-rounds" style={{ marginTop: 'var(--space-2)' }}>
                  {rounds.map((round, index) => (
                    <div class="round" key={index}>
                      <span class="rname">{squadRoundLabel(round)}</span>
                      <span class="ropp">{round.opponent ?? '—'}</span>
                      <span class={`rres ${round.won ? 'win' : 'loss'}`}>{squadRoundResult(round)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
      <div class="bottom">
        {props.stage === 'build' ? (
          !allBuilt ? (
            <button class="btn" disabled>
              Fill {SQUAD_SLOTS.length - built.length} more slot{SQUAD_SLOTS.length - built.length === 1 ? '' : 's'}
            </button>
          ) : !team ? (
            <button class="btn" disabled>
              Pick a team
            </button>
          ) : (
            <button class="btn" data-testid="squad-review" onClick={props.onReview}>
              Review strengths
            </button>
          )
        ) : null}
        {props.stage === 'review' ? (
          <div class="row">
            <button class="btn btn-ghost" data-testid="squad-review-back" onClick={props.onBackToBuild}>
              Back
            </button>
            <button class="btn" data-testid="squad-simulate" onClick={props.onStartSeason}>
              Start season
            </button>
          </div>
        ) : null}
        {props.stage === 'season' ? (
          seasonDone ? (
            <button class="btn" data-testid="squad-standings-next" onClick={props.onSeasonDone}>
              Review standings
            </button>
          ) : (
            <button class="btn btn-ghost" data-testid="squad-season-skip" onClick={props.onSeasonDone}>
              Skip to standings
            </button>
          )
        ) : null}
        {props.stage === 'standings' ? (
          <button class="btn" data-testid="squad-standings-next" onClick={props.onStandingsDone}>
            {rounds.length ? 'Playoffs' : 'Final recap'}
          </button>
        ) : null}
        {props.stage === 'playoffs' ? (
          revealed >= rounds.length ? (
            <button class="btn" data-testid="squad-recap-next" onClick={props.onPlayoffsDone}>
              See recap
            </button>
          ) : (
            <button class="btn btn-ghost" data-testid="squad-playoffs-skip" onClick={() => setRevealed(rounds.length)}>
              Skip to recap
            </button>
          )
        ) : null}
        {props.stage === 'recap' ? (
          <div class="row">
            <button class="btn" data-testid="squad-again" onClick={props.onAnotherSeason}>
              Another season
            </button>
            <button class="btn btn-ghost" data-testid="squad-new" onClick={props.onReset}>
              New squad
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
