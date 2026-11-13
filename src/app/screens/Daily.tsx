import type { Catalog } from '../../shared/data/loader';
import type { DailyPlan } from '../../shared/engine/daily';
import type { DailyDay } from '../../shared/modes';
import { TopBar } from '../components';

interface Props {
  plan: DailyPlan;
  day: DailyDay;
  catalog: Catalog;
  onPlay: () => void;
  onExit: () => void;
}

export function Daily(props: Props) {
  const { plan, day } = props;
  const nfl = plan.sport === 'nfl';
  const label = `${plan.pos.toUpperCase()} · ${plan.mode === 'all-time' ? 'ALL-TIME' : 'CURRENT'}`;
  const played = day.spins > 0;
  return (
    <div class="screen">
      <TopBar title="Daily Challenge" onBack={props.onExit} right={<span class="tiny muted">{plan.key}</span>} />
      <div class="body">
        <div class="card" data-testid="daily-card">
          <div class="tiny muted">TODAY · {nfl ? 'FOOTBALL' : 'BASKETBALL'}</div>
          <div class="title" style={{ marginTop: '2px' }}>
            {label}
          </div>
          <div class="muted" style={{ fontSize: '11px', marginTop: '4px' }}>
            Everyone gets the same spins today. One run: no resets, and leaving mid-run ends your day.
          </div>
          <div class="tiny muted" style={{ marginTop: '6px' }}>
            SEED {plan.seed}
          </div>
        </div>
        {nfl ? (
          <div class="notice bad" data-testid="daily-nfl">
            Football days are not part of this rebuild. The next basketball day starts tomorrow.
          </div>
        ) : null}
        {day.done ? (
          <div class="card" data-testid="daily-result">
            <div class="tiny muted">TODAY'S RESULT</div>
            <div class="title" style={{ marginTop: '2px' }}>
              {day.forfeit ? 'LEFT — NO SCORE' : `${day.ovr} OVR`}
            </div>
            <div class="muted" style={{ fontSize: '11px', marginTop: '4px' }}>
              {day.forfeit ? 'A Daily run only counts when it is finished.' : 'Come back tomorrow for a new set of spins.'}
            </div>
          </div>
        ) : (
          <div class="notice" data-testid="daily-rules">
            One attempt per day on this device. {played ? 'Your run is saved from where you left it.' : 'Resume is saved after every spin.'}
          </div>
        )}
      </div>
      <div class="bottom">
        {day.done || nfl ? (
          <button class="btn" onClick={props.onExit}>
            Back to menu
          </button>
        ) : (
          <button class="btn" data-testid="daily-play" onClick={props.onPlay}>
            {played ? 'Resume Daily' : 'Play Daily'} · {label}
          </button>
        )}
      </div>
    </div>
  );
}
