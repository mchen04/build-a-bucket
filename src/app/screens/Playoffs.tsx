import { useEffect, useState } from 'preact/hooks';
import type { PlayInRound, SeasonResult, SeriesRound } from '../../shared/engine/types';
import { TopBar } from '../components';

interface Props {
  season: SeasonResult;
  onAdvance: () => void;
}

function roundLabel(round: PlayInRound | SeriesRound): string {
  return round.type === 'playin' ? 'Play-In' : round.name;
}

function roundOpponent(round: PlayInRound | SeriesRound): string {
  return round.opponent.short;
}

function roundResult(round: PlayInRound | SeriesRound): string {
  if (round.type === 'playin') return round.games.join('-');
  return `${round.wins}-${round.losses}`;
}

export function Playoffs(props: Props) {
  const rounds = props.season.playoffRounds;
  const [revealed, setRevealed] = useState(0);
  const done = revealed >= rounds.length;

  useEffect(() => {
    if (done) return;
    const id = window.setTimeout(() => setRevealed((value) => value + 1), 520);
    return () => window.clearTimeout(id);
  }, [revealed, done]);

  return (
    <div class="screen">
      <TopBar
        title="Playoffs"
        right={<span class="tiny muted">Seed #{props.season.seed}</span>}
      />
      <div class="body">
        <div class="bracket">
          {rounds.slice(0, revealed).map((round, index) => {
            const won = round.type === 'playin' ? round.advanced : round.won;
            return (
              <div class="round fade-in" key={index}>
                <span class="rname">{roundLabel(round)}</span>
                <span class="ropp">{roundOpponent(round)}</span>
                <span class={`rres ${won ? 'win' : 'loss'}`}>{roundResult(round)}</span>
              </div>
            );
          })}
          {rounds.length === 0 ? (
            <div class="card center muted" style={{ fontSize: '12px' }}>
              No playoff games. The season ended early.
            </div>
          ) : null}
        </div>
        {done ? (
          <div class={`banner ${props.season.champion ? '' : 'miss'}`}>
            <h1>{props.season.champion ? 'CHAMPIONS' : props.season.madePlayoffs ? 'SEASON OVER' : 'ELIMINATED'}</h1>
            <p>
              {props.season.champion
                ? 'You won the title.'
                : props.season.finalsOpp
                  ? `Finals vs ${props.season.finalsOpp} · ${props.season.finalsSeries}`
                  : 'The run ends here.'}
            </p>
          </div>
        ) : (
          <p class="tiny muted center" style={{ margin: 0 }}>
            Revealing…
          </p>
        )}
      </div>
      <div class="bottom">
        {done ? (
          <button class="btn" onClick={props.onAdvance}>
            See Results
          </button>
        ) : (
          <button class="btn btn-ghost" onClick={() => setRevealed(rounds.length)}>
            Skip to Result
          </button>
        )}
      </div>
    </div>
  );
}
