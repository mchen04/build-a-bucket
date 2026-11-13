import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Catalog } from '../../shared/data/loader';
import { BARRIER_HOLD_SECONDS, DEFAULT_REVEAL_SECONDS, type LobbySettings } from '../../shared/mp/types';
import type { Position } from '../../shared/engine/types';
import { isBuildComplete, type RunState } from '../../shared/run';
import { TopBar } from '../components';
import { draftFromRun, latestPick, runFromDraft } from '../mp/draft';
import { activityLine, awaitingCount, phaseLabel, readyLabel } from '../mp/format';
import type { MpSession } from '../mp/session';
import { clearMpSession } from '../mp/session';
import { leaveLobbyRequest, releaseRequest, startLobbyRequest, submitBuildRequest, syncDraftRequest } from '../mp/api';
import { useLobby } from '../mp/useLobby';
import { Builder } from './Builder';
import { Roster } from './Roster';
import { TeamSpin } from './TeamSpin';

interface Props {
  session: MpSession;
  catalog: Catalog;
  onExit: (message: string | null) => void;
}

const EMPTY_SETTINGS: LobbySettings = {
  era: 'current',
  positions: ['guard', 'big'],
  revealSeconds: DEFAULT_REVEAL_SECONDS,
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function samePositions(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

export function Lobby(props: Props) {
  const { session, catalog } = props;
  const onGone = useCallback((message: string) => props.onExit(message), [props]);
  const { view, status, error, act, refresh } = useLobby(session, onGone);
  const [run, setRun] = useState<RunState | null>(null);
  const [position, setPosition] = useState<Position>('guard');
  const [screen, setScreen] = useState<'lobby' | 'build'>('lobby');
  const [settings, setSettings] = useState<LobbySettings>(EMPTY_SETTINGS);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seeded = useRef(false);
  const submitted = useRef(false);
  const releasedAt = useRef(0);

  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, []);

  useEffect(() => {
    if (!view || seeded.current) return;
    seeded.current = true;
    setSettings(view.settings);
    setPosition(view.settings.positions[0] ?? 'guard');
  }, [view]);

  useEffect(() => {
    if (!view || run) return;
    const stored = view.me.build;
    if (!stored) return;
    if (view.phase === 'lobby') return;
    setRun(runFromDraft(stored, `${view.code}:${view.me.seat}`));
    setPosition(stored.position);
  }, [view, run]);

  useEffect(() => {
    submitted.current = Boolean(view?.me.season);
  }, [view]);

  useEffect(() => {
    setRun(null);
    setScreen('lobby');
  }, [session.code]);

  useEffect(() => {
    const filled = run ? Object.keys(run.picks).length : 0;
    if (!run || screen !== 'build' || submitted.current || filled === 0) return undefined;
    const handle = window.setTimeout(() => {
      void act((code, secret) => syncDraftRequest(code, secret, draftFromRun(run, latestPick(run)))).catch(() => {
        return undefined;
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [run, screen, act]);

  const phase = view?.phase ?? 'lobby';
  const awaiting = view ? awaitingCount(view.participants) : 0;
  const awayWaiting = view
    ? view.participants.some(
        (entry) =>
          entry.status !== 'left' &&
          entry.away &&
          entry.status !== 'qualified' &&
          entry.status !== 'eliminated' &&
          entry.status !== 'done',
      )
    : false;

  useEffect(() => {
    if (!view || view.phase !== 'barrier' || awaiting > 0) return undefined;
    let handle = 0;
    const attempt = () => {
      releasedAt.current = Date.now();
      void act((code, secret) => releaseRequest(code, secret, false)).catch(() => undefined);
      handle = window.setTimeout(attempt, BARRIER_HOLD_SECONDS * 1000);
    };
    handle = window.setTimeout(attempt, Math.max(0, releasedAt.current + BARRIER_HOLD_SECONDS * 1000 - Date.now()));
    return () => window.clearTimeout(handle);
  }, [view?.version, view?.phase, awaiting, act]);

  const start = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await act((code, secret) => startLobbyRequest(code, secret, settings));
    } catch (caught) {
      setNotice(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!run) return;
    setBusy(true);
    setNotice(null);
    try {
      await act((code, secret) => submitBuildRequest(code, secret, draftFromRun(run, latestPick(run))));
      setScreen('lobby');
    } catch (caught) {
      setNotice(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const forceRelease = async () => {
    setBusy(true);
    try {
      await act((code, secret) => releaseRequest(code, secret, true));
    } catch (caught) {
      setNotice(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const exit = async (leave: boolean) => {
    if (leave) {
      try {
        await leaveLobbyRequest(session.code, session.secret);
      } catch {
        setNotice(null);
      }
    }
    clearMpSession();
    props.onExit(null);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(view?.code ?? '');
      setNotice('Invite code copied.');
    } catch {
      setNotice('Copy failed — read the code aloud.');
    }
  };

  const openBuilder = () => {
    if (!view) return;
    if (!run) {
      setRun(
        runFromDraft(
          {
            position,
            era: view.settings.era,
            picks: {},
            spinIndex: 0,
            teamRespinUsed: false,
            playerRespinUsed: false,
            current: null,
            team: null,
            latest: null,
          },
          `${view.code}:${view.me.seat}`,
        ),
      );
    }
    setScreen('build');
  };

  if (!view) {
    return (
      <div class="screen">
        <TopBar title={`Lobby ${session.code}`} onBack={() => void exit(false)} />
        <div class="body" style={{ justifyContent: 'center' }}>
          <p class="muted center">{status === 'reconnecting' ? 'Reconnecting to the lobby…' : 'Joining the lobby…'}</p>
          {error ? <div class="notice bad">{error}</div> : null}
          {status === 'reconnecting' ? (
            <button class="btn btn-ghost btn-small" onClick={refresh}>
              Try now
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const me = view.me;
  const roster = <Roster participants={view.participants} phase={view.phase} capacity={view.capacity} />;
  const peerStrip = (
    <>
      <Roster
        participants={view.participants}
        phase={view.phase}
        capacity={view.capacity}
        compact
        myProgress={run ? Object.keys(run.picks).length : undefined}
      />
      <div class="ticker" data-testid="activity-ticker">
        <span class="ticker-dot" />
        {activityLine(view.events[0])}
      </div>
    </>
  );
  const fullRoster = view.phase === 'lobby' || view.phase === 'building' || view.phase === 'season';

  if (screen === 'build' && run) {
    if (run.screen === 'team') {
      return (
        <TeamSpin
          run={run}
          catalog={catalog}
          onChange={setRun}
          onSimulate={() => void submit()}
          onBack={() => setRun({ ...run, screen: 'builder' })}
          simulateLabel={busy ? 'Submitting…' : 'Submit build'}
          simulateDisabled={busy}
          header={peerStrip}
        />
      );
    }
    return <Builder run={run} catalog={catalog} onChange={setRun} onBack={() => setScreen('lobby')} header={peerStrip} />;
  }

  const revealTotal = view.roundsTotal || 1;
  const nextReveal =
    view.playoffsStartedAt === null
      ? 0
      : Math.max(0, Date.parse(view.playoffsStartedAt) + view.roundsRevealed * view.revealSeconds * 1000 - now);
  const standings = view.standings ?? [];
  const champion = view.participants.find((entry) => entry.season?.champion) ?? null;
  const building = phase === 'building' || phase === 'season';
  const canBuild = building || (phase === 'barrier' && !me.season);

  return (
    <div class="screen">
      <TopBar
        title={`Lobby ${view.code}`}
        onBack={() => void exit(false)}
        right={
          <span class={`pill ${status === 'reconnecting' ? 'loss' : status === 'live' ? 'win' : ''}`} data-testid="lobby-status">
            {status === 'reconnecting' ? 'RECONNECTING' : phaseLabel(view.phase)}
          </span>
        }
      />
      <div class="body">
        {notice ? <div class="notice">{notice}</div> : null}
        {status === 'reconnecting' && error ? <div class="notice bad">Reconnecting… {error}</div> : null}

        {phase === 'lobby' ? (
          <div class="card mp-share">
            <div>
              <div class="tiny muted">Invite code</div>
              <div class="code" data-testid="lobby-code">
                {view.code}
              </div>
              <div class="tiny muted">No moments · the season runs straight through</div>
            </div>
            <div class="tiny muted" style={{ textAlign: 'right' }}>
              {view.seatsTaken}/{view.capacity} in
              <br />
              {me.isHost ? 'You host' : `Host: seat ${view.hostSeat ?? '?'}`}
            </div>
            <button class="btn btn-ghost btn-small" style={{ maxWidth: '80px' }} onClick={() => void copyCode()}>
              Copy
            </button>
          </div>
        ) : null}

        {fullRoster ? roster : peerStrip}

        {fullRoster ? (
          <div class="ticker" data-testid="activity-ticker">
            <span class="ticker-dot" />
            {activityLine(view.events[0])}
          </div>
        ) : null}

        {phase === 'lobby' ? (
          me.isHost ? (
            <div class="card" style={{ display: 'grid', gap: '6px' }}>
              <span class="tiny muted">Era · shared</span>
              <div class="seg">
                <button aria-pressed={settings.era === 'current'} onClick={() => setSettings({ ...settings, era: 'current' })}>
                  Current
                </button>
                <button aria-pressed={settings.era === 'alltime'} onClick={() => setSettings({ ...settings, era: 'alltime' })}>
                  All-Time
                </button>
              </div>
              <span class="tiny muted">Builds allowed</span>
              <div class="seg">
                <button
                  aria-pressed={samePositions(settings.positions, ['guard', 'big'])}
                  onClick={() => setSettings({ ...settings, positions: ['guard', 'big'] })}
                >
                  Both
                </button>
                <button
                  aria-pressed={samePositions(settings.positions, ['guard'])}
                  onClick={() => setSettings({ ...settings, positions: ['guard'] })}
                >
                  Guards
                </button>
                <button
                  aria-pressed={samePositions(settings.positions, ['big'])}
                  onClick={() => setSettings({ ...settings, positions: ['big'] })}
                >
                  Bigs
                </button>
              </div>
            </div>
          ) : (
            <div class="card">
              <div class="tiny muted">
                {view.settings.era === 'current' ? 'Current' : 'All-time'} · {view.settings.positions.join(' or ')} · no
                moments
              </div>
              <div style={{ fontWeight: 800, fontSize: '13px', marginTop: '2px' }}>Waiting for the host to start</div>
            </div>
          )
        ) : null}

        {canBuild ? (
          me.season ? (
            <div class="card">
              <div class="tiny muted">Season · no moments</div>
              <div style={{ fontWeight: 800, fontSize: '13px', marginTop: '2px' }} data-testid="building-state">
                {awaiting > 0 ? `${awaiting} still building` : 'Everyone is done — results in'}
              </div>
            </div>
          ) : (
            <div class="card">
              <div class="tiny muted">Season · no moments</div>
              <div style={{ fontWeight: 800, fontSize: '13px', marginTop: '2px' }} data-testid="building-state">
                {awaiting > 0 ? `${awaiting} still building` : 'Everyone is done — results in'}
              </div>
            </div>
          )
        ) : null}

        {me.season && view.phase !== 'lobby' ? (
          <div class="card" data-testid="my-result">
            <div class="tiny muted">Your season · no moments</div>
            <div style={{ fontWeight: 800, fontSize: '13px', marginTop: '2px' }}>
              {me.season.finishLabel ?? (me.season.qualified ? 'In the playoffs' : 'Out')} · {me.season.wins}-
              {me.season.losses} · #{me.season.seed}
              {me.season.qualified ? ' · in the playoffs' : ' · out'}
            </div>
          </div>
        ) : null}

        {canBuild && !run && view.settings.positions.length > 1 ? (
          <div class="card">
            <span class="tiny muted">Your build</span>
            <div class="seg">
              <button aria-pressed={position === 'guard'} onClick={() => setPosition('guard')}>
                Guard
              </button>
              <button aria-pressed={position === 'big'} onClick={() => setPosition('big')}>
                Big
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'barrier' || phase === 'playoffs' || phase === 'finished' ? (
          <div class="card">
            <div class="tiny muted">{phase === 'barrier' ? 'Barrier' : 'Barrier released'}</div>
            <div style={{ fontWeight: 800, fontSize: '13px', marginTop: '2px' }} data-testid="barrier-state">
              {readyLabel(view.participants)}
              {awayWaiting ? ' · someone is away' : phase === 'barrier' ? '' : ' · playoffs started together'}
            </div>
            {phase === 'barrier' ? (
              <div class="tiny muted" style={{ marginTop: '2px' }}>
                Playoffs start together once everyone present has a result
              </div>
            ) : null}
          </div>
        ) : null}

        {phase === 'playoffs' || phase === 'finished' ? (
          <>
            {champion ? (
              <div class="banner" data-testid="champion-banner">
                <h1 style={{ fontSize: '17px' }}>{champion.name} is the champion</h1>
                <p>
                  {champion.season?.wins}-{champion.season?.losses} · OVR {champion.season?.ovr}
                </p>
              </div>
            ) : null}
            <div class="card">
              <div class="tiny muted">
                Round {Math.min(view.roundsRevealed, revealTotal)} of {revealTotal} · reveal every {view.revealSeconds}s
              </div>
              <div style={{ fontWeight: 800, fontSize: '13px', marginTop: '2px', marginBottom: '6px' }}>
                {me.season
                  ? `${me.season.finishLabel ?? 'In the playoffs'} · ${me.season.wins}-${me.season.losses}`
                  : 'Spectating'}
              </div>
              {me.rounds.length ? (
                <div class="bracket">
                  {me.rounds.map((round) => (
                    <div class="round" key={`${round.name}-${round.opponent}`}>
                      <span class="rname">{round.name}</span>
                      <span class="ropp">vs {round.opponent}</span>
                      <span class={`rres ${round.won ? 'win' : 'loss'}`}>{round.label ?? `${round.wins}-${round.losses}`}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div class="tiny muted">
                  {me.season?.qualified ? 'Waiting for the first reveal…' : 'You did not make the playoffs.'}
                </div>
              )}
              {phase === 'playoffs' && nextReveal > 0 ? (
                <div class="tiny muted" style={{ marginTop: '4px' }} data-testid="next-reveal">
                  Next reveal in {Math.ceil(nextReveal / 1000)}s
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {phase === 'finished' && standings.length ? (
          <div class="table" data-testid="standings">
            <div class="table-row head">
              <span>#</span>
              <span>Player</span>
              <span>Record</span>
            </div>
            {standings.map((entry, index) => (
              <div class={`table-row${entry.isMe ? ' us' : ''}`} key={entry.seat} data-seat={entry.seat}>
                <span>{index + 1}</span>
                <span>
                  {entry.name} <span class="tiny muted">{entry.finishLabel}</span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  {entry.record}
                  <span class="tiny muted"> · {entry.ovr}</span>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div class="bottom">
        {phase === 'lobby' ? (
          me.isHost ? (
            <button class="btn" disabled={busy} onClick={() => void start()} data-testid="start-season">
              Start season · {view.seatsTaken} player{view.seatsTaken === 1 ? '' : 's'}
            </button>
          ) : (
            <button class="btn" disabled>
              Waiting for host
            </button>
          )
        ) : null}

        {canBuild ? (
          me.season ? (
            <button class="btn" disabled>
              Waiting for the others
            </button>
          ) : (
            <button class="btn" data-testid="open-builder" onClick={openBuilder}>
              {run && isBuildComplete(run)
                ? 'Spin for team'
                : run && Object.keys(run.picks).length
                  ? `Continue build · ${Object.keys(run.picks).length}/10`
                  : 'Build your player'}
            </button>
          )
        ) : null}

        {phase === 'barrier' && me.season ? (
          me.isHost && awayWaiting ? (
            <button class="btn" disabled={busy} onClick={() => void forceRelease()} data-testid="force-playoffs">
              Start playoffs now
            </button>
          ) : (
            <button class="btn" disabled>
              {awayWaiting ? 'Waiting on an away player' : 'Starting playoffs together…'}
            </button>
          )
        ) : null}

        {phase === 'playoffs' ? (
          <button class="btn" disabled>
            Revealing round {Math.min(view.roundsRevealed, revealTotal)} of {revealTotal}
          </button>
        ) : null}

        {phase === 'finished' ? (
          <button class="btn" onClick={() => void exit(false)} data-testid="leave-lobby">
            Close the lobby
          </button>
        ) : null}

        {phase !== 'finished' ? (
          <button class="btn btn-ghost btn-small" onClick={() => void exit(true)} data-testid="quit-lobby">
            Leave lobby
          </button>
        ) : null}
      </div>
    </div>
  );
}
