import { useEffect, useState } from 'preact/hooks';
import type { MomentCard, SeasonResult } from '../../shared/engine/types';
import type { RunState } from '../../shared/run';
import { StatGrid, TopBar } from '../components';

interface Props {
  run: RunState;
  moment: MomentCard | null;
  momentsOff: boolean;
  onChoose: (optionId: string) => void;
  onToggleMoments: () => void;
  onAdvance: () => void;
}

function Standings(props: { season: SeasonResult }) {
  return (
    <div class="table">
      {props.season.standings.map((row, index) => (
        <div class={`table-row ${row.isUs ? 'us' : ''}`} key={row.short}>
          <span class="table-seed">{index + 1}</span>
          <span class="table-team">{row.short}</span>
          <span class="table-wins">{row.wins}</span>
          <span class="table-note">{row.isUs ? 'YOU' : ''}</span>
        </div>
      ))}
    </div>
  );
}

export function Season(props: Props) {
  const { run, moment } = props;
  const games = run.draft?.games ?? run.season?.games ?? [];
  const total = games.length;
  const [played, setPlayed] = useState(0);
  const done = played >= total;
  const result = run.season;

  useEffect(() => {
    if (moment && props.run.draft) setPlayed(props.run.draft.games.length);
  }, [moment, props.run.draft]);

  useEffect(() => {
    if (done || moment) return;
    const id = window.setInterval(() => {
      setPlayed((value) => Math.min(total, value + 1));
    }, 28);
    return () => window.clearInterval(id);
  }, [done, total, moment]);

  const wins = games.slice(0, played).filter((game) => game.won).length;
  const losses = played - wins;
  const recent = games.slice(Math.max(0, played - 5), played).reverse();

  return (
    <div class="screen">
      <TopBar
        title="Season"
        right={
          <span class="row" style={{ gap: '8px' }}>
            <button class="icon-btn wide" aria-pressed={!props.momentsOff} onClick={props.onToggleMoments}>
              MOMENTS {props.momentsOff ? 'OFF' : 'ON'}
            </button>
            <span class="tiny muted">
              {played}/{total || 82}
            </span>
          </span>
        }
      />
      <div class="body">
        <div class="row" style={{ alignItems: 'flex-end' }}>
          <div>
            <div class="tiny muted">Record</div>
            <div style={{ fontSize: '26px', fontWeight: 900 }}>
              {wins}-{losses}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div class="tiny muted">Seed</div>
            <div style={{ fontSize: '26px', fontWeight: 900 }}>{result && done ? `#${result.seed}` : '—'}</div>
          </div>
        </div>

        {moment ? (
          <div class="card fade-in" data-testid="moment-card">
            <div class="tiny" style={{ letterSpacing: '0.12em', fontWeight: 800, color: 'var(--accent)' }}>
              {moment.kicker}
            </div>
            <div class="title" style={{ marginTop: '2px' }}>
              {moment.title}
            </div>
            <p class="muted" style={{ fontSize: '12px', lineHeight: 1.4, margin: '6px 0 0' }}>
              {moment.body}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
              {moment.options.map((option) => (
                <button class="btn btn-ghost btn-small" key={option.id} onClick={() => props.onChoose(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>
            {moment.options[0]?.flavor ? <div class="tiny muted" style={{ marginTop: '8px' }}>{moment.options[0].flavor}</div> : null}
          </div>
        ) : (
          <>
            <div class="recent">
              {recent.map((game) => (
                <span class={`pill ${game.won ? 'win' : 'loss'}`} key={game.g}>
                  {game.won ? 'W' : 'L'} {game.opponent} {game.mySc}-{game.oppSc}
                </span>
              ))}
            </div>
            {result && done ? (
              <>
                <div class="row">
                  <div class="award">
                    <span class="tag">MVP</span>
                    <span class="who">{result.displayMvp.name}</span>
                    <span class="num">{result.displayMvp.isPlayer ? 'YOU' : result.displayMvp.team}</span>
                  </div>
                </div>
                <Standings season={result} />
                <StatGrid
                  items={[
                    { label: 'PPG', value: result.ppg.toFixed(1) },
                    { label: 'RPG', value: result.rpg.toFixed(1) },
                    { label: 'APG', value: result.apg.toFixed(1) },
                    { label: 'PER', value: result.per.toFixed(1) },
                  ]}
                />
              </>
            ) : (
              <div class="card">
                <div class="tiny muted">
                  {props.run.draft ? 'Season under way. Moments decide as they come.' : 'Simulating…'}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div class="bottom">
        {moment ? null : done && result ? (
          <button class="btn" onClick={props.onAdvance}>
            {result.seed <= 10 ? 'Enter Playoffs' : 'See Results'}
          </button>
        ) : (
          <button class="btn" onClick={() => setPlayed(total)}>
            Skip to Result
          </button>
        )}
      </div>
    </div>
  );
}
