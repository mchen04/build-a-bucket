import type { Catalog } from '../../shared/data/loader';
import type { DailyPlan } from '../../shared/engine/daily';
import type { DailyDay } from '../../shared/modes';
import { StatGrid, TopBar } from '../components';

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
  const season = day.run?.season ?? null;
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
            Same spins for everyone. One run.
          </div>
        </div>
        {nfl ? (
          <div class="notice bad" data-testid="daily-nfl">
            Football days are not in this rebuild. Next basketball day tomorrow.
          </div>
        ) : null}
        {day.done ? (
          <div class="card" data-testid="daily-result">
            <div class="tiny muted">TODAY'S RESULT</div>
            {day.forfeit || !season ? (
              <>
                <div class="title" style={{ marginTop: '2px' }}>
                  No score
                </div>
                <div class="muted" style={{ fontSize: '11px', marginTop: '4px' }}>
                  A Daily run only counts when it is finished.
                </div>
              </>
            ) : (
              <>
                <div class="title" style={{ marginTop: '2px' }}>
                  {day.ovr ?? season.ovr} OVR
                </div>
                <StatGrid
                  items={[
                    { label: 'Record', value: `${season.wins}-${season.losses}` },
                    { label: 'Seed', value: `#${season.seed}` },
                    { label: 'PPG', value: season.ppg.toFixed(1) },
                    { label: 'PER', value: season.per.toFixed(1) },
                  ]}
                />
                <div class="result-line">
                  {season.champion ? 'Champions' : season.madePlayoffs ? 'Playoffs' : 'Missed playoffs'}
                </div>
              </>
            )}
          </div>
        ) : (
          <div class="notice" data-testid="daily-rules">
            One run per day. {played ? 'Resume saved.' : 'Progress saves after every spin.'}
          </div>
        )}
      </div>
      <div class="bottom">
        {day.done || nfl ? (
          <div class="row">
            {day.done && season ? (
              <button class="btn" data-testid="daily-view" onClick={props.onPlay}>
                View result
              </button>
            ) : null}
            <button class="btn btn-ghost" onClick={props.onExit}>
              Back to menu
            </button>
          </div>
        ) : (
          <button class="btn" data-testid="daily-play" onClick={props.onPlay}>
            {played ? 'Resume Daily' : 'Play Daily'}
          </button>
        )}
      </div>
    </div>
  );
}
