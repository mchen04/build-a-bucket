import type { LobbyView } from '../../shared/mp/types';
import { readyLabel } from '../mp/format';

interface Props {
  view: LobbyView;
  busy: boolean;
  onReady: () => void;
  onAdvance: () => void;
}

function scoreLine(home: string, away: string, homeScore: number, awayScore: number, mine: boolean): string {
  return `${home} ${homeScore} — ${awayScore} ${away}${mine ? ' · YOU' : ''}`;
}

export function LeaguePanel(props: Props) {
  const league = props.view.league;
  if (!league) return null;
  const my = league.my;
  const games = [...league.games].sort((a, b) => b.gameNo - a.gameNo).slice(0, 14);
  const standings = league.standings;
  const showStandings = standings
    ? (['east', 'west'] as const).map((conference) => {
        const rows = standings.filter((row) => row.conference === conference);
        const top = rows.slice(0, 10);
        const extras = rows.filter((row) => row.isMine && !top.includes(row));
        return { conference, rows: [...top, ...extras] };
      })
    : [];
  const rounds = league.playoffs
    ? [...new Set(league.playoffs.map((entry) => entry.round))].sort((a, b) => a - b)
    : [];
  const atCheckpoint = league.checkpoint && props.view.phase !== 'recap';

  return (
    <>
      <div class="card" data-testid="league-stage">
        <div class="row" style={{ alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div class="tiny muted">Stage {league.stage + 1} · {league.stageName}</div>
            <div style={{ fontWeight: 900, fontSize: '14px' }}>
              {league.stageTotal > 0 ? `${Math.min(league.cursor, league.stageTotal)} / ${league.stageTotal}` : 'Checkpoint'}
            </div>
          </div>
          <div class="tiny muted" style={{ textAlign: 'right' }}>
            {atCheckpoint ? 'Paused for everyone' : league.stageTotal > 0 ? 'Revealing' : 'Ready'}
          </div>
        </div>
        {league.stageTotal > 0 ? (
          <div class="bar" style={{ marginTop: '6px' }}>
            <span style={{ width: `${Math.round((Math.min(league.cursor, league.stageTotal) / league.stageTotal) * 100)}%` }} />
          </div>
        ) : null}
      </div>

      {my ? (
        <div class="card" data-testid="my-team">
          <div class="tiny muted">Your team</div>
          <div style={{ fontWeight: 900, fontSize: '15px' }}>
            {my.team} · {my.wins}-{my.losses}
            {my.seed ? ` · #${my.seed}` : ''}
          </div>
          <div class="tiny muted">
            {my.finish ?? (my.madePlayoffs === null ? 'Season in progress' : my.madePlayoffs ? 'In the playoffs' : 'Out')}
            {my.mvp ? ' · MVP' : ''}
            {my.dpoy ? ' · DPOY' : ''}
          </div>
          {my.ppg !== null ? (
            <div class="tiny">
              {my.ppg} PPG · {my.rpg} RPG · {my.apg} APG · {my.spg} SPG · {my.bpg} BPG
            </div>
          ) : null}
        </div>
      ) : null}

      {league.recap ? (
        <div class="banner" data-testid="champion-banner">
          <h1 style={{ fontSize: '17px' }}>{league.recap.champion} are champions</h1>
          <p>{league.recap.championName === league.recap.champion ? 'A computer team took it' : `${league.recap.championName} took it`}</p>
        </div>
      ) : null}

      {games.length ? (
        <div class="card" data-testid="league-games">
          <div class="tiny muted">Latest results</div>
          {games.map((game) => (
            <div class="tiny" key={game.gameNo} style={{ fontWeight: game.mine ? 800 : 500 }}>
              {scoreLine(game.home, game.away, game.homeScore, game.awayScore, game.mine)}
              {game.friends && !game.mine ? ' · friends' : ''}
            </div>
          ))}
        </div>
      ) : null}

      {showStandings.length ? (
        <div class="card" data-testid="standings">
          <div class="tiny muted">Standings</div>
          {showStandings.map(({ conference, rows }) => (
            <div key={conference} style={{ marginTop: '4px' }}>
              <div class="tiny muted">{conference === 'east' ? 'EAST' : 'WEST'}</div>
              <div class="table">
                {rows.map((row) => (
                  <div class={`table-row${row.isMine ? ' us' : ''}`} key={row.team}>
                    <span>{row.seed ?? '—'}</span>
                    <span>
                      {row.team}
                      {row.humanName ? <span class="tiny muted"> · {row.humanName}</span> : null}
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      {row.wins}-{row.losses}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {league.awards ? (
        <div class="card" data-testid="awards">
          <div class="tiny muted">Awards</div>
          <div class="tiny">
            <strong>MVP</strong> · {league.awards.mvp.name} ({league.awards.mvp.team})
          </div>
          <div class="tiny">
            <strong>DPOY</strong> · {league.awards.dpoy.name} ({league.awards.dpoy.team})
          </div>
        </div>
      ) : null}

      {league.playin ? (
        <div class="card" data-testid="playin">
          <div class="tiny muted">Play-In</div>
          {league.playin.map((game) => (
            <div class="tiny" key={game.id}>
              {game.conference.toUpperCase()} · {scoreLine(game.home, game.away, game.homeScore, game.awayScore, false)}
            </div>
          ))}
        </div>
      ) : null}

      {rounds.length ? (
        <div class="card" data-testid="playoffs">
          {rounds.map((round) => (
            <div key={round} style={{ marginTop: round === rounds[0] ? 0 : '6px' }}>
              <div class="tiny muted">
                {league.playoffs?.find((entry) => entry.round === round)?.name ?? `Round ${round}`}
              </div>
              {league.playoffs
                ?.filter((entry) => entry.round === round)
                .map((series) => (
                  <div class="tiny" key={series.id} style={{ fontWeight: series.high === my?.team || series.low === my?.team ? 800 : 500 }}>
                    {series.high} ({series.highSeed}) vs {series.low} ({series.lowSeed}) · {series.wins}-{series.losses}
                    {series.winner ? ` · ${series.winner} won` : ''}
                  </div>
                ))}
            </div>
          ))}
        </div>
      ) : null}

      {league.recap ? (
        <div class="card" data-testid="recap">
          <div class="tiny muted">Final recap</div>
          {league.recap.entries.map((entry) => (
            <div class="tiny" key={entry.seat}>
              {entry.champion ? '🏆 ' : ''}
              {entry.name} · {entry.team} · {entry.wins}-{entry.losses} · {entry.finish}
            </div>
          ))}
          <div class="tiny muted" style={{ marginTop: '6px' }}>Head to head</div>
          {league.recap.h2h.map((record) => (
            <div class="tiny" key={`${record.a}-${record.b}`}>
              {record.a === props.view.me.name ? 'You' : record.a} vs {record.b}: {record.wins}-{record.losses}
            </div>
          ))}
        </div>
      ) : null}

      {atCheckpoint ? (
        <div class="card">
          <div class="tiny muted">Checkpoint</div>
          <div style={{ fontWeight: 800, fontSize: '13px' }}>{readyLabel(props.view.ready)}</div>
          <div class="row" style={{ marginTop: '6px' }}>
            {props.view.ready.mine ? (
              <button class="btn btn-small" disabled>
                Ready
              </button>
            ) : (
              <button class="btn btn-small" disabled={props.busy} onClick={props.onReady}>
                Ready
              </button>
            )}
            {props.view.me.isHost ? (
              <button class="btn btn-ghost btn-small" disabled={props.busy} onClick={props.onAdvance}>
                Advance
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
