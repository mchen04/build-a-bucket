import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Catalog } from '../../shared/data/loader';
import { photoFor, poolFor } from '../../shared/data/loader';
import { archetypeFor } from '../../shared/engine/archetype';
import { computeOvr } from '../../shared/engine/ovr';
import { heightLabel, valueLabel, weightLabel } from '../../shared/engine/rules';
import { spinTarget, teamCandidates } from '../../shared/engine/spin';
import type { Player } from '../../shared/engine/types';
import { heightWeightFor, isBuildComplete, openOptions, pickOptions, placePick, respinSeedFor, type RunState } from '../../shared/run';
import { Avatar, SlotGrid, TopBar } from '../components';
import { readGradesHidden, writeGradesHidden } from '../prefs';

interface Props {
  run: RunState;
  catalog: Catalog;
  onChange: (run: RunState) => void;
  onBack: () => void;
  header?: ComponentChildren;
  completeLabel?: string;
  onComplete?: () => void;
}

export function Builder(props: Props) {
  const { run, catalog } = props;
  const pool = poolFor(catalog, run.position, run.era);
  const [spinning, setSpinning] = useState(false);
  const [reelTeam, setReelTeam] = useState('—');
  const [reelPlayer, setReelPlayer] = useState('—');
  const [message, setMessage] = useState<string | null>(null);
  const [showGrades, setShowGrades] = useState(() => !readGradesHidden());
  const timer = useRef<number | null>(null);
  const ticker = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (ticker.current) window.clearInterval(ticker.current);
  }, []);

  const currentPlayer: Player | null = run.current
    ? pool.find((player) => player.name === run.current?.playerName && player.team === run.current?.team) ?? null
    : null;
  const complete = isBuildComplete(run);
  const ovr = computeOvr(run.picks, run.position);
  const archetype = archetypeFor(ovr, run.picks, run.position);
  const options = currentPlayer ? pickOptions(run, currentPlayer) : [];
  const placeable = openOptions(options);
  const size = heightWeightFor(run);
  const build = [heightLabel(size.height), weightLabel(size.weight)].filter(Boolean).join(' · ');

  const toggleGrades = () => {
    const next = !showGrades;
    setShowGrades(next);
    writeGradesHidden(!next);
  };

  const spin = (teamRespin: boolean, playerRespin: boolean) => {
    if (spinning || complete) return;
    const target = spinTarget(
      pool,
      run.seed,
      run.spinIndex,
      teamRespin,
      playerRespin ? 1 : 0,
      respinSeedFor(run),
    );
    if (!target) {
      setMessage('No players available for this pool.');
      return;
    }
    setMessage(null);
    setSpinning(true);
    const teams = teamCandidates(pool);
    ticker.current = window.setInterval(() => {
      setReelTeam(teams[Math.floor(Math.random() * teams.length)] ?? '—');
      const randomPlayer = pool[Math.floor(Math.random() * pool.length)];
      setReelPlayer(randomPlayer?.short ?? '—');
    }, 55);
    timer.current = window.setTimeout(() => {
      if (ticker.current) window.clearInterval(ticker.current);
      setSpinning(false);
      setReelTeam(target.team);
      setReelPlayer(target.player.short);
      props.onChange({
        ...run,
        current: { team: target.team, playerName: target.player.name },
        currentRespin: { team: teamRespin, player: playerRespin },
        teamRespinUsed: teamRespin ? true : run.teamRespinUsed,
        playerRespinUsed: playerRespin ? true : run.playerRespinUsed,
      });
    }, 620);
  };

  const place = (attr: string) => {
    if (!currentPlayer) return;
    if (run.picks[attr]) {
      setMessage('That slot is already filled.');
      return;
    }
    if (placeable.length === 0) {
      setMessage('All available slots filled for this PLAYER');
      return;
    }
    setMessage(null);
    props.onChange(placePick(run, currentPlayer, attr, photoFor(catalog, currentPlayer)));
  };

  const teamName = catalog.teams.find((team) => team.short === (currentPlayer?.team ?? run.current?.team))?.name;

  return (
    <div class="screen">
      <TopBar
        title={`${run.position === 'guard' ? 'Guard' : 'Big'} · ${run.era === 'current' ? 'Current' : 'All-Time'}`}
        onBack={props.onBack}
        right={
          <button class="icon-btn wide" aria-pressed={!showGrades} onClick={toggleGrades}>
            {showGrades ? 'GRADES' : 'NUMBERS'}
          </button>
        }
      />
      {props.header}
      <div class="body">
        <SlotGrid run={run} showGrades={showGrades} />
        <div class="row" style={{ alignItems: 'center' }}>
          <div>
            <div class="tiny muted">OVR</div>
            <div style={{ fontSize: '22px', fontWeight: 900 }} data-testid="builder-ovr">
              {ovr || '—'}
            </div>
          </div>
          <div style={{ flex: 2, textAlign: 'right' }}>
            <div class="tiny muted">{build ? `Archetype · ${build}` : 'Archetype'}</div>
            <div style={{ fontSize: '13px', fontWeight: 800 }}>{archetype}</div>
          </div>
        </div>

        <div class="stage">
          {currentPlayer ? (
            <div class="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div class="player-card">
                <Avatar photo={photoFor(catalog, currentPlayer)} name={currentPlayer.name} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    data-testid="source-name"
                    style={{ fontWeight: 900, fontSize: '15px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {currentPlayer.name}
                  </div>
                  <div class="tiny muted" data-testid="source-team">
                    {currentPlayer.team} · {teamName ?? ''} {currentPlayer.number ? `#${currentPlayer.number}` : ''}
                    {build ? ` · ${build}` : ''}
                  </div>
                </div>
                <div class="tiny muted">{currentPlayer.years ?? ''}</div>
              </div>
              {placeable.length === 0 ? (
                <div class="notice" data-testid="no-slots">
                  All available slots filled for this PLAYER
                </div>
              ) : null}
              <div class="chips">
                {options.map((option) => (
                  <button
                    class="chip"
                    key={option.attr}
                    disabled={option.filled}
                    onClick={() => place(option.attr)}
                    data-attr={option.attr}
                    data-val={option.val}
                    aria-label={`${option.label} ${valueLabel(option.val, showGrades)}`}
                  >
                    <Avatar photo={photoFor(catalog, currentPlayer)} name={currentPlayer.name} size={20} />
                    <span class="chip-key">{option.short}</span>
                    <span class="chip-val">{valueLabel(option.val, showGrades)}</span>
                  </button>
                ))}
              </div>
              <div class="row">
                <button
                  class="btn btn-ghost btn-small"
                  disabled={run.teamRespinUsed || spinning}
                  onClick={() => spin(true, false)}
                >
                  Respin Team {run.teamRespinUsed ? '· used' : '· 1'}
                </button>
                <button
                  class="btn btn-ghost btn-small"
                  disabled={run.playerRespinUsed || spinning}
                  onClick={() => spin(false, true)}
                >
                  Respin Player {run.playerRespinUsed ? '· used' : '· 1'}
                </button>
              </div>
            </div>
          ) : complete ? (
            <div class="card center fade-in">
              <div class="tiny muted">All 10 slots filled — simulate your season</div>
              <div class="title" style={{ marginTop: '4px' }}>{archetype}</div>
              <div class="muted" style={{ fontSize: '12px', marginTop: '4px' }}>
                OVR {ovr} · 10 traits locked{build ? ` · ${build}` : ''}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div class="reel">
                <span class="reel-label">Team</span>
                <span class={`reel-value ${spinning ? 'spinning' : ''}`}>{reelTeam}</span>
              </div>
              <div class="reel">
                <span class="reel-label">Player</span>
                <span class={`reel-value ${spinning ? 'spinning' : ''}`}>{reelPlayer}</span>
              </div>
              <button class="spin-big" disabled={spinning} onClick={() => spin(false, false)}>
                {spinning ? 'SPINNING' : 'SPIN'}
              </button>
            </div>
          )}
          {message ? <div class="notice">{message}</div> : null}
        </div>
      </div>
      <div class="bottom">
        {complete ? (
          <button
            class="btn"
            onClick={() => (props.onComplete ? props.onComplete() : props.onChange({ ...run, screen: 'team' }))}
          >
            {props.completeLabel ?? 'Spin for Team'}
          </button>
        ) : currentPlayer ? (
          <button class="btn" disabled>
            Tap a trait to fill a slot
          </button>
        ) : (
          <button class="btn" disabled>
            {spinning ? 'Spinning…' : 'Spin to build'}
          </button>
        )}
      </div>
    </div>
  );
}
