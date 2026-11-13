import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Catalog } from '../../shared/data/loader';
import { CURRENT_TEAMS, ALLTIME_TEAMS } from '../../shared/engine/rules';
import { suppliedTeams, type RunState } from '../../shared/run';
import { TopBar } from '../components';

interface Props {
  run: RunState;
  catalog: Catalog;
  onChange: (run: RunState) => void;
  onSimulate: () => void;
  onBack: () => void;
  simulateLabel?: string;
  simulateDisabled?: boolean;
  header?: ComponentChildren;
}

export function TeamSpin(props: Props) {
  const { run, catalog } = props;
  const candidates = suppliedTeams(run);
  const [mode, setMode] = useState<'spin' | 'pick'>('spin');
  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState(run.team ?? '—');
  const timer = useRef<number | null>(null);
  const ticker = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (ticker.current) window.clearInterval(ticker.current);
  }, []);

  const table = run.era === 'alltime' ? ALLTIME_TEAMS : CURRENT_TEAMS;
  const team = run.team ? catalog.teams.find((entry) => entry.short === run.team) : null;
  const row = run.team ? table[run.team] : null;

  const spin = () => {
    if (spinning || candidates.length === 0) return;
    setSpinning(true);
    ticker.current = window.setInterval(() => {
      setReel(candidates[Math.floor(Math.random() * candidates.length)] ?? '—');
    }, 55);
    timer.current = window.setTimeout(() => {
      if (ticker.current) window.clearInterval(ticker.current);
      const picked = candidates[Math.floor(Math.random() * candidates.length)] ?? candidates[0];
      setSpinning(false);
      setReel(picked ?? '—');
      if (picked) props.onChange({ ...run, team: picked });
    }, 620);
  };

  return (
    <div class="screen">
      <TopBar title="Team Spin" onBack={props.onBack} right={<span class="tiny muted">{candidates.length} teams</span>} />
      {props.header}
      <div class="body">
        <div class="seg">
          <button aria-pressed={mode === 'spin'} onClick={() => setMode('spin')}>
            Spin
          </button>
          <button aria-pressed={mode === 'pick'} onClick={() => setMode('pick')}>
            Pick
          </button>
        </div>
        {mode === 'spin' ? (
          <div class="stage">
            <div class="reel" style={{ height: '84px' }}>
              <span class="reel-label">Team</span>
              <span class={`reel-value ${spinning ? 'spinning' : ''}`} style={{ fontSize: '30px' }}>
                {reel}
              </span>
            </div>
            <button class="spin-big" disabled={spinning} onClick={spin}>
              {spinning ? 'SPINNING' : 'SPIN'}
            </button>
            <p class="tiny muted center" style={{ margin: 0 }}>
              Teams that supplied your traits
            </p>
          </div>
        ) : (
          <div class="teams">
            {catalog.teams.map((entry) => (
              <button
                class="team-btn"
                key={entry.short}
                aria-pressed={run.team === entry.short}
                onClick={() => props.onChange({ ...run, team: entry.short })}
              >
                {entry.short}
              </button>
            ))}
          </div>
        )}
        {team && row ? (
          <div class="card fade-in" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: team.color,
                border: `2px solid ${team.color2}`,
                flex: 'none',
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 900, fontSize: '14px' }}>{team.name}</div>
              <div class="tiny muted">
                OFF {row.off} · DEF {row.def}
              </div>
            </div>
            <div class="tiny muted">{run.era === 'alltime' ? 'ALL-TIME' : 'CURRENT'}</div>
          </div>
        ) : null}
      </div>
      <div class="bottom">
        <button class="btn" disabled={!run.team || props.simulateDisabled === true} onClick={props.onSimulate}>
          {props.simulateLabel ?? 'Simulate Season'}
        </button>
      </div>
    </div>
  );
}
