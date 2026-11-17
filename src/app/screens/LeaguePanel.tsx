import type { LeagueGameView, PlayInView, SeriesView } from '../../shared/mp/league';
import type { LobbyView } from '../../shared/mp/types';
import { StatGrid, StandingsTable, YouTag } from '../components';
import { activityLine } from '../mp/format';

interface Props {
  view: LobbyView;
  busy: boolean;
  onReady: () => void;
  onAdvance: () => void;
}

function ResultRow(props: {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  myTeam: string | null;
  mine?: boolean;
  friends?: boolean;
}) {
  const homeMine = props.myTeam !== null && props.home === props.myTeam;
  const awayMine = props.myTeam !== null && props.away === props.myTeam;
  return (
    <div class={`result-row${props.mine ? ' mine' : ''}`}>
      <span class="result-team">
        {props.home}
        {homeMine ? <YouTag /> : null}
      </span>
      <span class="result-score">
        {props.homeScore}–{props.awayScore}
        {props.friends ? <span class="result-tag">FRIENDS</span> : null}
      </span>
      <span class="result-team away">
        {awayMine ? <YouTag /> : null}
        {props.away}
      </span>
    </div>
  );
}

function SeriesRow(props: { series: SeriesView; myTeam: string | null }) {
  const mine = props.myTeam !== null && (props.series.high === props.myTeam || props.series.low === props.myTeam);
  return (
    <div class={`series${mine ? ' mine' : ''}`}>
      <span class="series-team">
        {props.series.high}
        <small>#{props.series.highSeed}</small>
      </span>
      <span class="series-score">
        {props.series.wins}–{props.series.losses}
      </span>
      <span class="series-team low">
        <small>#{props.series.lowSeed}</small>
        {props.series.low}
      </span>
      {props.series.games.length ? (
        <span class="series-games">
          {props.series.games.map((game) => (
            <span class={`series-game ${game.winner === props.series.high ? 'win' : 'loss'}`} key={game.index}>
              {game.homeScore}-{game.awayScore}
            </span>
          ))}
        </span>
      ) : null}
      {props.series.winner ? <span class="series-winner">{props.series.winner} wins the series</span> : null}
    </div>
  );
}

export function LeaguePanel(props: Props) {
  return <LeaguePanelView {...props} />;
}

function LeaguePanelView(props: Props) {
  const league = props.view.league;
  if (!league) return null;
  const my = league.my;
  const myTeam = my?.team ?? null;
  const humanTeams = new Set((league.standings ?? []).filter((row) => row.humanName).map((row) => row.team));
  const playoffGames: LeagueGameView[] = (league.playoffs ?? []).flatMap((series, seriesIndex) =>
    series.games.map((game) => ({
      gameNo: series.round * 1000 + seriesIndex * 10 + game.index,
      stage: series.round + 5,
      home: game.home,
      away: game.away,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      winner: game.winner,
      mine: game.home === myTeam || game.away === myTeam,
      friends: humanTeams.has(game.home) && humanTeams.has(game.away),
    })),
  );
  const playinGames: LeagueGameView[] = (league.playin ?? []).map((game, index) => ({
    gameNo: 5000 + index,
    stage: 5,
    home: game.home,
    away: game.away,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    winner: game.winner,
    mine: game.home === myTeam || game.away === myTeam,
    friends: humanTeams.has(game.home) && humanTeams.has(game.away),
  }));
  const visibleGames =
    (league.phase === 'playoffs' || league.phase === 'recap') && playoffGames.length
      ? playoffGames
      : league.phase === 'playin' && playinGames.length
        ? playinGames
        : [...league.games];
  const allGames = visibleGames.sort((a, b) => b.gameNo - a.gameNo);
  const highlighted = allGames.filter((game) => game.mine || game.friends).slice(0, 6);
  const recent = allGames.filter((game) => !game.mine && !game.friends).slice(0, 4);
  const games = [...highlighted, ...recent].sort((a, b) => b.gameNo - a.gameNo).slice(0, 8);
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
  const gate = props.view.gate;
  const progress = league.stageTotal > 0 ? Math.min(league.cursor, league.stageTotal) : null;
  const status =
    league.phase === 'recap'
      ? 'Final'
      : gate?.active
        ? 'Playoff gate'
        : league.phase === 'season' || league.phase === 'playoffs'
          ? 'Revealing'
          : 'Ready';
  const nextAction =
    gate?.active && gate
      ? gate.nextAction
      : league.phase === 'recap'
        ? 'League complete'
        : my?.eliminated
          ? `Eliminated in the ${my.eliminatedRound ?? 'playoffs'}`
          : league.phase === 'season'
            ? 'Season resolving automatically'
            : league.phase === 'awards'
              ? 'Awards · play-in next'
              : league.phase === 'playin'
                ? 'Play-in resolving automatically'
                : my?.madePlayoffs === false
                  ? 'You are out · watching the playoffs'
                  : 'Games resolve automatically';
  const myStats = my
    ? [
        my.ppg !== null ? { label: 'PPG', value: my.ppg.toFixed(1) } : null,
        my.rpg !== null ? { label: 'RPG', value: my.rpg.toFixed(1) } : null,
        my.apg !== null ? { label: 'APG', value: my.apg.toFixed(1) } : null,
        my.spg !== null ? { label: 'SPG', value: my.spg.toFixed(1) } : null,
        my.bpg !== null ? { label: 'BPG', value: my.bpg.toFixed(1) } : null,
      ].filter((entry): entry is { label: string; value: string } => entry !== null)
    : [];

  return (
    <>
      {league.phase !== 'recap' ? (
        <div class="card" data-testid="league-stage">
          <div class="row" style={{ alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div class="tiny muted">{league.stageName}</div>
              <div style={{ fontWeight: 900, fontSize: 'var(--text-md)' }}>
                {gate?.active ? 'Game 1 next' : progress !== null ? `${progress} / ${league.stageTotal}` : 'Checkpoint'}
              </div>
            </div>
            <div class="tiny muted" style={{ textAlign: 'right' }}>
              {status}
            </div>
          </div>
          <div class="tiny" style={{ marginTop: 'var(--space-2)' }} data-testid="next-action">
            {nextAction}
          </div>
          {progress !== null && league.stageTotal > 0 ? (
            <div class="progress" style={{ marginTop: 'var(--space-2)' }}>
              <div style={{ width: `${Math.round((progress / league.stageTotal) * 100)}%` }} />
            </div>
          ) : null}
        </div>
      ) : null}

      {gate?.active ? (
        <div class="card" data-testid="playoff-gate">
          <div class="row" style={{ alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 'var(--text-sm)' }}>
                {gate.ready}/{gate.qualified} playoff teams ready
              </div>
            </div>
            {gate.mine && !props.view.me.ready ? (
              <button class="btn btn-small" disabled={props.busy} onClick={props.onReady}>
                Ready
              </button>
            ) : props.view.me.ready ? (
              <button class="btn btn-small" disabled>
                Ready
              </button>
            ) : null}
            {gate.host ? (
              <button class="btn btn-ghost btn-small" disabled={props.busy} onClick={props.onAdvance}>
                Start playoffs
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {my?.series ? (
        <div class="card" data-testid="my-matchup">
          <div class="tiny muted">{my.series.name}</div>
          <div style={{ fontWeight: 900, fontSize: 'var(--text-md)' }}>
            {my.series.high} {my.series.wins}–{my.series.losses} {my.series.low}
          </div>
          <div class="tiny muted">
            {my.series.wins + my.series.losses === 0
              ? 'Series starts after the games ahead of it'
              : `${my.series.wins + my.series.losses} game${my.series.wins + my.series.losses === 1 ? '' : 's'} played${
                  my.series.complete
                    ? my.series.advanced
                      ? ' · advanced'
                      : ' · eliminated'
                    : my.series.winner
                      ? ` · ${my.series.winner} advanced`
                      : ' · in progress'
                }`}
          </div>
        </div>
      ) : null}

      {my ? (
        <div class="card" data-testid="my-team">
          <div class="tiny muted">Your team</div>
          <div style={{ fontWeight: 900, fontSize: 'var(--text-md)' }}>
            {my.team} <YouTag /> {my.wins}-{my.losses}
            {my.seed ? ` · #${my.seed}` : ''}
          </div>
          <div class="tiny muted">
            {my.finish ??
              (my.madePlayoffs === null
                ? my.seed !== null
                  ? `#${my.seed} seed`
                  : 'Season in progress'
                : my.madePlayoffs
                  ? 'In the playoffs'
                  : 'Out')}
            {my.mvp ? ' · MVP' : ''}
            {my.dpoy ? ' · DPOY' : ''}
            {my.champion ? ' · Champion' : ''}
          </div>
          {myStats.length ? <StatGrid items={myStats} className="five" /> : null}
        </div>
      ) : null}

      {league.recap ? (
        <div class="banner" data-testid="champion-banner">
          <h1 style={{ fontSize: 'var(--text-lg)' }}>{league.recap.champion} are champions</h1>
          <p>
            {league.recap.championName === league.recap.champion
              ? 'A computer team took it'
              : `${league.recap.championName} took it`}
          </p>
        </div>
      ) : null}

      <div class="card" data-testid="activity-log">
        <div class="tiny muted">League activity</div>
        {props.view.events.length ? (
          props.view.events.slice(0, 12).map((event) => (
            <div class="tiny" key={event.id} style={{ marginTop: '2px' }}>
              {activityLine(event)}
            </div>
          ))
        ) : (
          <div class="tiny muted">No events yet</div>
        )}
      </div>

      {league.recap ? (
        <div class="card" data-testid="recap">
          <div class="tiny muted">Final recap</div>
          {league.recap.entries.map((entry) => (
            <div class={`recap-row${entry.champion ? ' champ' : ''}`} key={entry.seat}>
              <span class="recap-name">
                {entry.champion ? '🏆 ' : ''}
                {entry.name}
              </span>
              <span class="recap-record">
                {entry.wins}-{entry.losses}
              </span>
              <span class="recap-team">{entry.team}</span>
              <span class="recap-finish">{entry.finish}</span>
            </div>
          ))}
          <div class="tiny muted" style={{ marginTop: 'var(--space-2)' }}>
            Head to head
          </div>
          {league.recap.h2h.map((record) => (
            <div class="h2h-row" key={`${record.a}-${record.b}`}>
              <span class="h2h-names">
                {record.a === props.view.me.name ? 'You' : record.a} vs {record.b}
              </span>
              <span class="h2h-record">
                {record.wins}-{record.losses}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {games.length ? (
        <div class="card" data-testid="league-games">
          <div class="tiny muted">Latest results</div>
          {games.map((game: LeagueGameView) => (
            <ResultRow
              key={game.gameNo}
              home={game.home}
              away={game.away}
              homeScore={game.homeScore}
              awayScore={game.awayScore}
              myTeam={myTeam}
              mine={game.mine}
              friends={game.friends}
            />
          ))}
        </div>
      ) : null}

      {showStandings.length ? (
        <div class="card" data-testid="standings">
          <div class="tiny muted">Standings</div>
          {showStandings.map(({ conference, rows }) => (
            <div key={conference} style={{ marginTop: 'var(--space-2)' }}>
              <div class="tiny muted">{conference === 'east' ? 'EAST' : 'WEST'}</div>
              <StandingsTable
                rows={rows.map((row) => ({
                  key: row.team,
                  seed: row.seed,
                  team: row.team,
                  name: row.humanName,
                  wins: row.wins,
                  losses: row.losses,
                  isMine: row.isMine,
                }))}
                showSeed
                showLosses
                showGB
                compact
              />
            </div>
          ))}
        </div>
      ) : null}

      {league.awards ? (
        <div class="card" data-testid="awards">
          <div class="tiny muted">Awards</div>
          <div class="award">
            <span class="tag">MVP</span>
            <span class="who">
              {league.awards.mvp.name}
              {league.awards.mvp.mine ? <YouTag /> : null}
            </span>
            <span class="num">{league.awards.mvp.team}</span>
          </div>
          <div class="award">
            <span class="tag">DPOY</span>
            <span class="who">
              {league.awards.dpoy.name}
              {league.awards.dpoy.mine ? <YouTag /> : null}
            </span>
            <span class="num">{league.awards.dpoy.team}</span>
          </div>
        </div>
      ) : null}

      {league.playin ? (
        <div class="card" data-testid="playin">
          <div class="tiny muted">Play-In</div>
          {league.playin.map((game: PlayInView) => (
            <div key={game.id}>
              <div class="tiny muted">
                {game.conference.toUpperCase()} · {game.label}
              </div>
              <ResultRow
                home={game.home}
                away={game.away}
                homeScore={game.homeScore}
                awayScore={game.awayScore}
                myTeam={myTeam}
              />
            </div>
          ))}
        </div>
      ) : null}

      {rounds.length ? (
        <div class="card" data-testid="playoffs">
          <div class="tiny muted">Playoffs</div>
          <div class="bracket">
            {rounds.map((round) => (
              <div class="round-card" key={round}>
                <div class="round-name">
                  {league.playoffs?.find((entry) => entry.round === round)?.name ?? `Round ${round}`}
                </div>
                {league.playoffs
                  ?.filter((entry) => entry.round === round)
                  .map((series) => (
                    <SeriesRow key={series.id} series={series} myTeam={myTeam} />
                  ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

    </>
  );
}
