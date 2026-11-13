import { useEffect, useRef, useState } from 'preact/hooks';
import type { Catalog } from '../../shared/data/loader';
import { poolFor } from '../../shared/data/loader';
import { archetypeFor } from '../../shared/engine/archetype';
import { computeOvr } from '../../shared/engine/ovr';
import { ATTR_LABELS, gradeFor } from '../../shared/engine/rules';
import { spinTarget, teamCandidates } from '../../shared/engine/spin';
import type { Player } from '../../shared/engine/types';
import { isBuildComplete, placePick, respinSeedFor, type RunState } from '../../shared/run';
import { Avatar, SlotGrid, TopBar } from '../components';

interface Props {
  run: RunState;
  catalog: Catalog;
  onChange: (run: RunState) => void;
  onBack: () => void;
}

export function Builder(props: Props) {
  const { run, catalog } = props;
  const pool = poolFor(catalog, run.position, run.era);
  const [spinning, setSpinning] = useState(false);
  const [reelTeam, setReelTeam] = useState('—');
  const [reelPlayer, setReelPlayer] = useState('—');
  const [message, setMessage] = useState<string | null>(null);
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
  const placeable = currentPlayer
    ? Object.keys(currentPlayer.attrs).filter((attr) => ATTR_LABELS[attr] && !run.picks[attr])
    : [];

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
    props.onChange(placePick(run, currentPlayer, attr));
  };

  const teamName = catalog.teams.find((team) => team.short === (currentPlayer?.team ?? run.current?.team))?.name;

  return (
    <div class="screen">
      <TopBar
        title={`${run.position === 'guard' ? 'Guard' : 'Big'} · ${run.era === 'current' ? 'Current' : 'All-Time'}`}
        onBack={props.onBack}
        right={<span class="tiny muted">{Object.keys(run.picks).length}/10</span>}
      />
      <div class="body">
        <SlotGrid run={run} />
        <div class="row" style={{ alignItems: 'center' }}>
          <div>
            <div class="tiny muted">OVR</div>
            <div style={{ fontSize: '22px', fontWeight: 900 }}>{ovr || '—'}</div>
          </div>
          <div style={{ flex: 2, textAlign: 'right' }}>
            <div class="tiny muted">Archetype</div>
            <div style={{ fontSize: '13px', fontWeight: 800 }}>{archetype}</div>
          </div>
        </div>

        <div class="stage">
          {complete ? (
            <div class="card center fade-in">
              <div class="tiny muted">Build complete</div>
              <div class="title" style={{ marginTop: '4px' }}>{archetype}</div>
              <div class="muted" style={{ fontSize: '12px', marginTop: '4px' }}>
                OVR {ovr} · 10 traits locked
              </div>
            </div>
          ) : currentPlayer ? (
            <div class="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div class="player-card">
                <Avatar catalog={catalog} player={currentPlayer} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: '15px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {currentPlayer.name}
                  </div>
                  <div class="tiny muted">
                    {currentPlayer.team} · {teamName ?? ''} {currentPlayer.number ? `#${currentPlayer.number}` : ''}
                  </div>
                </div>
                <div class="tiny muted">{currentPlayer.years ?? ''}</div>
              </div>
              {placeable.length === 0 ? (
                <div class="notice">All available slots filled for this PLAYER</div>
              ) : null}
              <div class="chips">
                {Object.keys(currentPlayer.attrs)
                  .filter((attr) => ATTR_LABELS[attr])
                  .map((attr) => {
                    const filled = Boolean(run.picks[attr]);
                    return (
                      <button
                        class="chip"
                        key={attr}
                        disabled={filled}
                        onClick={() => place(attr)}
                        aria-label={`${ATTR_LABELS[attr]?.label} ${gradeFor(currentPlayer.attrs[attr] ?? 0)}`}
                      >
                        <span class="chip-key">{ATTR_LABELS[attr]?.short}</span>
                        <span class="chip-val">{gradeFor(currentPlayer.attrs[attr] ?? 0)}</span>
                      </button>
                    );
                  })}
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
          <button class="btn" onClick={() => props.onChange({ ...run, screen: 'team' })}>
            Spin for Team
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
