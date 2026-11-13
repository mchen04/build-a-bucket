import { useEffect, useState } from 'preact/hooks';
import type { SeasonResult } from '../../shared/engine/types';
import { StatGrid, TopBar } from '../components';

interface Props {
  season: SeasonResult;
  onAdvance: () => void;
}

export function Season(props: Props) {
  const [played, setPlayed] = useState(0);
  const total = props.season.games.length;
  const done = played >= total;

  useEffect(() => {
    if (done) return;
    const id = window.setInterval(() => {
      setPlayed((value) => Math.min(total, value + 1));
    }, 28);
    return () => window.clearInterval(id);
  }, [done, total]);

  const wins = props.season.games.slice(0, played).filter((game) => game.won).length;
  const losses = played - wins;
  const recent = props.season.games.slice(Math.max(0, played - 5), played).reverse();

  return (
    <div class="screen">
      <TopBar
        title="Season"
        right={<span class="tiny muted">{played}/{total}</span>}
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
            <div style={{ fontSize: '26px', fontWeight: 900 }}>{done ? `#${props.season.seed}` : '—'}</div>
          </div>
        </div>
        <div class="progress">
          <div style={{ width: `${(played / total) * 100}%` }} />
        </div>
        <div class="row" style={{ gap: '4px' }}>
          {recent.map((game) => (
            <span
              key={game.g}
              class={`tiny ${game.won ? 'win' : 'loss'}`}
              style={{ fontWeight: 900, textAlign: 'center' }}
            >
              {game.won ? 'W' : 'L'}
            </span>
          ))}
        </div>
        <div class="table">
          <div class="table-row head">
            <span>#</span>
            <span>Team</span>
            <span>W</span>
          </div>
          {props.season.standings.map((row, index) => (
            <div class={`table-row ${row.isUs ? 'us' : ''}`} key={row.short}>
              <span>{index + 1}</span>
              <span>{row.short}</span>
              <span>{row.wins}</span>
            </div>
          ))}
        </div>
        {done ? (
          <div class="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div class="award">
              <span class="tag">MVP</span>
              <span class="who">{props.season.displayMvp.name}</span>
              <span class="num">
                {props.season.displayMvp.ppg?.toFixed(1)} / {props.season.displayMvp.rpg?.toFixed(1)} /{' '}
                {props.season.displayMvp.apg?.toFixed(1)}
              </span>
            </div>
            <div class="award">
              <span class="tag">DPOY</span>
              <span class="who">{props.season.displayDpoy.name}</span>
              <span class="num">
                {props.season.displayDpoy.spg?.toFixed(1)} SPG · {props.season.displayDpoy.bpg?.toFixed(1)} BPG
              </span>
            </div>
            <p class="tiny muted" style={{ margin: 0 }}>
              Season moments are not available in this rebuild.
            </p>
          </div>
        ) : (
          <StatGrid
            items={[
              { label: 'PPG', value: props.season.ppg.toFixed(1) },
              { label: 'RPG', value: props.season.rpg.toFixed(1) },
              { label: 'APG', value: props.season.apg.toFixed(1) },
              { label: 'PER', value: props.season.per.toFixed(1) },
            ]}
          />
        )}
      </div>
      <div class="bottom">
        {done ? (
          <button class="btn" onClick={props.onAdvance}>
            {props.season.seed <= 10 ? 'Enter Playoffs' : 'See Results'}
          </button>
        ) : (
          <button class="btn btn-ghost" onClick={() => setPlayed(total)}>
            Skip to Result
          </button>
        )}
      </div>
    </div>
  );
}
