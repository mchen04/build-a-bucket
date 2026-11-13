import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Catalog } from '../../shared/data/loader';
import type { Position } from '../../shared/engine/types';
import type {
  LobbySettings,
  LobbyView,
  NormalBuild,
  SalaryBuild,
  SalaryCardPick,
  SquadBuild,
  SquadPlayerBuild,
} from '../../shared/mp/types';
import { createRun, isBuildComplete, type RunState } from '../../shared/run';
import { TopBar } from '../components';
import {
  advanceRequest,
  drawRequest,
  leaveLobbyRequest,
  lockRequest,
  readyRequest,
  rematchRequest,
  rerollRequest,
  startLobbyRequest,
  submitBuildRequest,
} from '../mp/api';
import { clearLocalDraft, readLocalDraft, saveLocalDraft } from '../mp/draftStore';
import { activityLine, phaseLabel, readyLabel } from '../mp/format';
import { clearMpSession, type MpSession } from '../mp/session';
import { useLobby } from '../mp/useLobby';
import { Builder } from './Builder';
import { LeaguePanel } from './LeaguePanel';
import { LobbySalary } from './LobbySalary';
import { LobbySquad } from './LobbySquad';
import { Roster } from './Roster';

interface Props {
  session: MpSession;
  catalog: Catalog;
  onExit: (message: string | null) => void;
}

const EMPTY_SETTINGS: LobbySettings = { era: 'current', mode: 'normal' };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function Lobby(props: Props) {
  const { session, catalog } = props;
  const onGone = useCallback(
    (message: string) => {
      clearLocalDraft(session.code);
      props.onExit(message);
    },
    [props, session.code],
  );
  const { view, status, error, act, refresh } = useLobby(session, onGone);
  const [run, setRun] = useState<RunState | null>(null);
  const [position, setPosition] = useState<Position>('guard');
  const [screen, setScreen] = useState<'lobby' | 'build' | 'salary' | 'squad'>('lobby');
  const [settings, setSettings] = useState<LobbySettings>(EMPTY_SETTINGS);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seeded = useRef(false);

  const updateRun = useCallback(
    (next: RunState | null) => {
      setRun(next);
      if (next) saveLocalDraft(session.code, next);
      else clearLocalDraft(session.code);
    },
    [session.code],
  );

  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, []);

  useEffect(() => {
    if (!view || seeded.current) return;
    seeded.current = true;
    setSettings(view.settings);
    setPosition('guard');
  }, [view]);

  useEffect(() => {
    setRun(null);
    setScreen('lobby');
  }, [session.code]);

  useEffect(() => {
    if (view?.phase === 'draw') updateRun(null);
  }, [view?.phase, updateRun]);

  useEffect(() => {
    if (!view) return;
    if (view.phase !== 'building' || view.me.status === 'ready') {
      if (screen !== 'lobby') setScreen('lobby');
    }
  }, [view?.phase, view?.me.status, screen]);

  const runAction = async (action: (code: string, secret: string) => Promise<LobbyView>) => {
    setBusy(true);
    setNotice(null);
    try {
      await act(action);
    } catch (caught) {
      setNotice(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const start = () => runAction((code, secret) => startLobbyRequest(code, secret, settings));
  const draw = () => runAction((code, secret) => drawRequest(code, secret));
  const reroll = () => runAction((code, secret) => rerollRequest(code, secret));
  const lock = () => runAction((code, secret) => lockRequest(code, secret));
  const ready = () => (view ? runAction((code, secret) => readyRequest(code, secret, view.stage)) : undefined);
  const advance = () => (view ? runAction((code, secret) => advanceRequest(code, secret, view.stage)) : undefined);
  const rematch = () => {
    updateRun(null);
    return runAction((code, secret) => rematchRequest(code, secret));
  };

  const openNormal = () => {
    if (!view) return;
    const local = readLocalDraft(view.code);
    if (local && local.era === view.settings.era) setRun(local);
    else updateRun({ ...createRun(`${view.code}:${view.me.seat}:${view.settings.era}`, position, view.settings.era), team: view.me.team });
    setScreen('build');
  };

  const submitNormal = async () => {
    if (!run) return;
    const build: NormalBuild = { kind: 'normal', position: run.position, era: run.era, picks: run.picks };
    setBusy(true);
    setNotice(null);
    try {
      await act((code, secret) => submitBuildRequest(code, secret, build));
      updateRun(null);
      setScreen('lobby');
    } catch (caught) {
      setNotice(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const submitSalary = async (cards: SalaryCardPick[]) => {
    const build: SalaryBuild = { kind: 'salary', position: cards[4]?.posGroup ?? 'guard', cards };
    setBusy(true);
    setNotice(null);
    try {
      await act((code, secret) => submitBuildRequest(code, secret, build));
      setScreen('lobby');
    } catch (caught) {
      setNotice(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const submitSquad = async (players: SquadPlayerBuild[]) => {
    const build: SquadBuild = { kind: 'squad', players };
    setBusy(true);
    setNotice(null);
    try {
      await act((code, secret) => submitBuildRequest(code, secret, build));
      setScreen('lobby');
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
    clearLocalDraft(session.code);
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
  const peerStrip = (
    <>
      <Roster participants={view.participants} phase={view.phase} capacity={view.capacity} compact />
      <div class="ticker" data-testid="activity-ticker">
        <span class="ticker-dot" />
        {activityLine(view.events[0])}
      </div>
    </>
  );

  if (screen === 'build' && run && view.phase === 'building' && me.status !== 'ready') {
    return (
      <Builder
        run={run}
        catalog={catalog}
        header={peerStrip}
        onChange={updateRun}
        onBack={() => setScreen('lobby')}
        completeLabel={busy ? 'Submitting…' : 'Submit build'}
        onComplete={() => void submitNormal()}
      />
    );
  }

  if (screen === 'salary' && view.salaryBoard && view.salaryBudget !== null && view.phase === 'building' && me.status !== 'ready') {
    return (
      <LobbySalary
        board={view.salaryBoard}
        budget={view.salaryBudget}
        busy={busy}
        header={peerStrip}
        onBack={() => setScreen('lobby')}
        onSubmit={(cards) => void submitSalary(cards)}
      />
    );
  }

  if (screen === 'squad' && view.phase === 'building' && me.status !== 'ready') {
    return (
      <LobbySquad
        catalog={catalog}
        era={view.settings.era}
        team={me.team}
        busy={busy}
        header={peerStrip}
        onBack={() => setScreen('lobby')}
        onSubmit={(players) => void submitSquad(players)}
      />
    );
  }

  const present = view.participants.filter((entry) => entry.status !== 'left');
  const leaguePhase = view.phase === 'season' || view.phase === 'awards' || view.phase === 'playin' || view.phase === 'playoffs' || view.phase === 'recap';
  const nextReveal =
    view.stageStartedAt === null || view.league === null || view.league.stageTotal === 0
      ? 0
      : Math.max(0, Date.parse(view.stageStartedAt) + view.league.stageTotal * 1200 - now);

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

        {view.phase === 'lobby' ? (
          <div class="card mp-share">
            <div>
              <div class="tiny muted">Invite code</div>
              <div class="code" data-testid="lobby-code">
                {view.code}
              </div>
              <div class="tiny muted">One shared NBA season · 2–8 friends</div>
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

        <Roster participants={view.participants} phase={view.phase} capacity={view.capacity} />
        <div class="ticker" data-testid="activity-ticker">
          <span class="ticker-dot" />
          {activityLine(view.events[0])}
        </div>

        {view.phase === 'lobby' ? (
          me.isHost ? (
            <div class="card" style={{ display: 'grid', gap: '6px' }}>
              <span class="tiny muted">Mode · shared</span>
              <div class="seg">
                <button aria-pressed={settings.mode === 'normal'} onClick={() => setSettings({ ...settings, mode: 'normal' })}>
                  Normal
                </button>
                <button aria-pressed={settings.mode === 'salary'} onClick={() => setSettings({ ...settings, mode: 'salary' })}>
                  Salary
                </button>
                <button aria-pressed={settings.mode === 'squad'} onClick={() => setSettings({ ...settings, mode: 'squad' })}>
                  Squad
                </button>
              </div>
              <span class="tiny muted">Era · shared</span>
              <div class="seg">
                <button aria-pressed={settings.era === 'current'} onClick={() => setSettings({ ...settings, era: 'current' })}>
                  Current
                </button>
                <button aria-pressed={settings.era === 'alltime'} onClick={() => setSettings({ ...settings, era: 'alltime' })}>
                  All-Time
                </button>
              </div>
            </div>
          ) : (
            <div class="card">
              <div class="tiny muted">
                {view.settings.mode === 'normal' ? 'Normal' : view.settings.mode === 'salary' ? 'Salary Cap' : 'Squad'} ·{' '}
                {view.settings.era === 'current' ? 'Current' : 'All-time'}
              </div>
              <div style={{ fontWeight: 800, fontSize: '13px', marginTop: '2px' }}>Waiting for the host to start</div>
            </div>
          )
        ) : null}

        {view.phase === 'draw' ? (
          <>
            <div class="card">
              <div class="tiny muted">Team draw</div>
              <div style={{ fontWeight: 800, fontSize: '13px' }}>
                {me.team ? `You are the ${me.team}` : 'Draw a team from the unclaimed pool'}
              </div>
              <div class="tiny muted">
                {view.teams.length}/{present.length} teams drawn · one reroll each
              </div>
            </div>
            {view.teams.length ? (
              <div class="card">
                {view.teams.map((entry) => (
                  <div class="tiny" key={entry.seat} style={{ fontWeight: entry.isMe ? 800 : 500 }}>
                    {entry.name} · {entry.team}
                    {entry.rerollUsed ? ' · rerolled' : ''}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {view.phase === 'building' ? (
          <div class="card">
            <div class="tiny muted">
              {view.settings.mode === 'normal' ? 'Normal build' : view.settings.mode === 'salary' ? 'Salary Cap build' : 'Squad build'}
            </div>
            <div style={{ fontWeight: 800, fontSize: '13px', marginTop: '2px' }} data-testid="building-state">
              {me.status === 'ready'
                ? 'Build submitted — waiting for the others'
                : `${view.ready.ready}/${view.ready.present} builds in`}
            </div>
            {me.team ? <div class="tiny muted">Your team · {me.team}</div> : null}
          </div>
        ) : null}

        {view.phase === 'preview' ? (
          <div class="card">
            <div class="tiny muted">Team preview</div>
            {view.teams.map((entry) => {
              const participant = view.participants.find((candidate) => candidate.seat === entry.seat);
              return (
                <div class="tiny" key={entry.seat} style={{ fontWeight: entry.isMe ? 800 : 500 }}>
                  {entry.name} · {entry.team}
                  {participant?.summary ? ` · OVR ${participant.summary.ovr}` : ''}
                </div>
              );
            })}
            <div class="tiny muted" style={{ marginTop: '4px' }}>{readyLabel(view.ready)}</div>
          </div>
        ) : null}

        {leaguePhase ? <LeaguePanel view={view} busy={busy} onReady={() => void ready()} onAdvance={() => void advance()} /> : null}

        {view.phase === 'season' && view.league && !view.league.checkpoint && nextReveal > 0 ? (
          <div class="tiny muted" data-testid="next-reveal">
            Next batch in {Math.ceil(nextReveal / 1000)}s
          </div>
        ) : null}
      </div>

      <div class="bottom">
        {view.phase === 'lobby' ? (
          me.isHost ? (
            <button class="btn" disabled={busy} onClick={() => void start()} data-testid="start-season">
              Start league · {view.seatsTaken} player{view.seatsTaken === 1 ? '' : 's'}
            </button>
          ) : (
            <button class="btn" disabled>
              Waiting for host
            </button>
          )
        ) : null}

        {view.phase === 'draw' ? (
          me.team ? (
            <div class="row">
              <button class="btn" disabled={busy || me.rerollUsed} onClick={() => void reroll()} data-testid="reroll-team">
                {me.rerollUsed ? 'Reroll used' : 'Reroll team'}
              </button>
              {me.isHost ? (
                <button class="btn btn-ghost" disabled={busy} onClick={() => void lock()} data-testid="lock-teams">
                  Lock teams
                </button>
              ) : null}
            </div>
          ) : (
            <button class="btn" disabled={busy} onClick={() => void draw()} data-testid="draw-team">
              Draw team
            </button>
          )
        ) : null}

        {view.phase === 'building' && me.status !== 'ready' ? (
          view.settings.mode === 'normal' ? (
            <div class="row">
              <div class="seg" style={{ flex: 1 }}>
                <button aria-pressed={position === 'guard'} onClick={() => setPosition('guard')}>
                  Guard
                </button>
                <button aria-pressed={position === 'big'} onClick={() => setPosition('big')}>
                  Big
                </button>
              </div>
              <button class="btn" data-testid="open-builder" onClick={openNormal}>
                {run && isBuildComplete(run) ? 'Review build' : run && Object.keys(run.picks).length ? `Continue · ${Object.keys(run.picks).length}/10` : 'Build your player'}
              </button>
            </div>
          ) : view.settings.mode === 'salary' ? (
            <button class="btn" data-testid="open-builder" onClick={() => setScreen('salary')}>
              Open salary board
            </button>
          ) : (
            <button class="btn" data-testid="open-builder" onClick={() => setScreen('squad')}>
              Build your five
            </button>
          )
        ) : null}

        {view.phase === 'building' && me.status === 'ready' ? (
          <button class="btn" disabled>
            Waiting for the others
          </button>
        ) : null}

        {view.phase === 'preview' ? (
          <div class="row">
            <button class="btn" disabled={busy || view.ready.mine} onClick={() => void ready()} data-testid="preview-ready">
              {view.ready.mine ? 'Ready' : 'Ready for the season'}
            </button>
            {me.isHost ? (
              <button class="btn btn-ghost" disabled={busy} onClick={() => void advance()} data-testid="start-season-now">
                Start season
              </button>
            ) : null}
          </div>
        ) : null}

        {view.phase === 'recap' ? (
          <div class="row">
            {me.isHost ? (
              <button class="btn" disabled={busy} onClick={() => void rematch()} data-testid="rematch">
                Rematch
              </button>
            ) : null}
            <button class="btn btn-ghost" onClick={() => void exit(false)} data-testid="leave-lobby">
              Close the lobby
            </button>
          </div>
        ) : null}

        {view.phase !== 'recap' ? (
          <button class="btn btn-ghost btn-small" onClick={() => void exit(true)} data-testid="quit-lobby">
            Leave lobby
          </button>
        ) : null}
      </div>
    </div>
  );
}
