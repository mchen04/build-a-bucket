import type { Catalog } from '../../shared/data/loader';
import type { DailyPlan } from '../../shared/engine/daily';
import type { DailyDay } from '../../shared/modes';
import { StatGrid, TopBar } from '../components';
import { dailyResult } from '../mp/dailyResult';

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
  const view = dailyResult(day);
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
            {view.forfeit || !view.hasResult ? (
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
                <div class="row" style={{ alignItems: 'flex-end', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div class="title" style={{ marginTop: '2px' }}>
                      {view.ovr ?? '—'} OVR
                    </div>
                    <div class="tiny muted">
                      {[view.archetype, view.team, view.position?.toUpperCase(), view.era === 'alltime' ? 'ALL-TIME' : view.era?.toUpperCase()]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <div class="tiny" style={{ textAlign: 'right', fontWeight: 800, color: 'var(--accent)' }}>
                    {view.finish}
                  </div>
                </div>
                <div class="result-line">
                  {view.record ? `${view.record} · SEED #${view.seed ?? '—'}` : 'Record unavailable'}
                  {view.per !== null ? ` · PER ${view.per.toFixed(1)}` : ''}
                </div>
                {view.stats.length ? <StatGrid items={view.stats} className="five" /> : null}
                <div class="tiny muted" style={{ marginTop: 'var(--space-2)' }}>
                  Build
                </div>
                {view.build.length ? (
                  <div class="build-grid" data-testid="daily-build">
                    {view.build.map((trait) => (
                      <div class="build-trait" key={trait.attr}>
                        <span class="build-key">{trait.short}</span>
                        <span class={`build-grade ${trait.tone}`}>{trait.grade}</span>
                        <span class="build-player">{trait.playerName}</span>
                        <span class="build-team">{trait.team}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div class="tiny muted">Build details not saved.</div>
                )}
                <div class="tiny muted" style={{ marginTop: 'var(--space-2)' }}>
                  Awards
                </div>
                <div data-testid="daily-awards">
                  {view.awards.length ? (
                    view.awards.map((award) => (
                      <div class="award" key={award.label}>
                        <span class="tag">{award.label}</span>
                        <span class="who">{award.name}</span>
                        <span class="num">{award.mine ? 'YOU' : award.team}</span>
                      </div>
                    ))
                  ) : (
                    <div class="tiny muted">No awards.</div>
                  )}
                </div>
                <div class="tiny muted" style={{ marginTop: 'var(--space-2)' }}>
                  Season journey
                </div>
                {view.run ? (
                  <div class="season-run" data-testid="daily-run">
                    {view.run.split('').map((mark, index) => (
                      <span class={`season-mark ${mark === 'W' ? 'win' : 'loss'}`} key={index}>
                        {mark}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div class="tiny muted">Season details not saved.</div>
                )}
                {view.bestGame ? (
                  <div class="tiny muted" style={{ marginTop: 'var(--space-1)' }}>
                    Best game {view.bestGame.pts} PTS · {view.bestGame.reb} REB · {view.bestGame.ast} AST vs{' '}
                    {view.bestGame.opponent} ({view.bestGame.mySc}-{view.bestGame.oppSc})
                  </div>
                ) : null}
                {view.rounds.length ? (
                  <div class="bracket" data-testid="daily-rounds" style={{ marginTop: 'var(--space-2)' }}>
                    {view.rounds.map((round, index) => (
                      <div class="round" key={index}>
                        <span class="rname">{round.label}</span>
                        <span class="ropp">{round.opponent}</span>
                        <span class={`rres ${round.won ? 'win' : 'loss'}`}>{round.result}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {view.fallback ? (
                  <div class="tiny muted" style={{ marginTop: 'var(--space-2)' }}>
                    Saved before full results were stored.
                  </div>
                ) : null}
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
            {view.season ? (
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
