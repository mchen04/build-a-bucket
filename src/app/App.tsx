import { Component, type ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { loadCatalog, type Catalog } from '../shared/data/loader';
import { loadMomentBank, type MomentBank } from '../shared/data/moments';
import type { DailyPlan } from '../shared/engine/daily';
import { randomSeed } from '../shared/engine/rng';
import {
  chooseMoment,
  finalizeDraft,
  passStop,
  startSeason,
  type SeasonDraft,
} from '../shared/engine/season';
import type { Era, MomentCard, Position } from '../shared/engine/types';
import { dailyDay, planForToday, saveDailyDay, type DailyDay } from '../shared/modes';
import { clearRun, loadRun, saveRun } from '../shared/persistence';
import { createRun, type RunState } from '../shared/run';
import { LazyScreen } from './lazy';
import type { MpEntry } from './modes/LobbyMode';
import type { MpSession } from './mp/session';
import { pickMoment } from './momentFlow';
import { readMomentsOff, recentMoments, rememberMoment, writeMomentsOff } from './prefs';
import { Builder } from './screens/Builder';
import { End } from './screens/End';
import { Home } from './screens/Home';
import { Playoffs } from './screens/Playoffs';
import { Season } from './screens/Season';
import { TeamSpin } from './screens/TeamSpin';

const loadDaily = () => import('./screens/Daily').then((module) => module.Daily);
const loadSalary = () => import('./modes/SalaryMode').then((module) => module.SalaryMode);
const loadSquad = () => import('./modes/SquadMode').then((module) => module.SquadMode);
const loadLobby = () => import('./modes/LobbyMode').then((module) => module.LobbyMode);
const loadCareer = () => import('./modes/CareerMode').then((module) => module.CareerMode);

type Flow = 'classic' | 'daily' | 'squad' | 'salary' | 'career';

function careerHint(): string {
  try {
    const raw = localStorage.getItem('bab:career:v1');
    if (!raw) return 'Draft day to the Hall';
    const parsed = JSON.parse(raw) as { slots?: unknown };
    const slots = Array.isArray(parsed?.slots) ? parsed.slots : [];
    const active = slots.find(
      (entry) => entry && typeof entry === 'object' && (entry as { phase?: string }).phase !== 'retired',
    ) as { name?: string; year?: number } | undefined;
    if (!active) return 'Draft day to the Hall';
    return `Resume ${active.name ?? 'your player'} · year ${(active.year ?? 0) + 1}`;
  } catch {
    return 'Draft day to the Hall';
  }
}

function savedMpEntry(): MpEntry | null {
  try {
    const raw = localStorage.getItem('bab:mp:v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: unknown; code?: unknown; secret?: unknown; name?: unknown };
    if (parsed?.v !== 1) return null;
    if (typeof parsed.code !== 'string' || typeof parsed.secret !== 'string' || typeof parsed.name !== 'string') return null;
    const session: MpSession = { v: 1, code: parsed.code, secret: parsed.secret, name: parsed.name };
    return { kind: 'resume', session };
  } catch {
    return null;
  }
}

class ErrorBoundary extends Component<{ children: ComponentChildren }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div class="screen">
          <div class="body" style={{ justifyContent: 'center' }}>
            <div class="notice bad">Something broke. Your saved run is safe. Reload to continue.</div>
            <button class="btn" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [momentsOff, setMomentsOff] = useState(() => readMomentsOff());
  const [mpEntry, setMpEntry] = useState<MpEntry | null>(() => savedMpEntry());
  const [mpNotice, setMpNotice] = useState<string | null>(null);
  const bank = useRef<MomentBank | null>(null);

  const [flow, setFlow] = useState<Flow>('classic');
  const [plan] = useState<DailyPlan>(() => planForToday());
  const [daily, setDaily] = useState<DailyDay | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [dailyPlaying, setDailyPlaying] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoadError(null);
    loadCatalog()
      .then((value) => {
        if (alive) setCatalog(value);
      })
      .catch((error: unknown) => {
        if (alive) setLoadError(error instanceof Error ? error.message : 'Could not load player data.');
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => {
    const outcome = loadRun();
    if (outcome.status === 'ok') setRun(outcome.run);
    if (outcome.status === 'corrupt') {
      clearRun();
      setNotice('Saved run was unreadable. Starting fresh.');
    }
    const today = dailyDay(plan.key);
    setDaily(today);
    if (today.run && !today.done) {
      setFlow('daily');
      setDailyPlaying(true);
    }
  }, [plan.key]);

  const commit = useCallback((next: RunState) => {
    saveRun(next);
    setRun(next);
  }, []);

  const start = (position: Position, era: Era) => {
    setNotice(null);
    setMpNotice(null);
    setFlow('classic');
    commit(createRun(randomSeed(), position, era));
  };

  const advanceDraft = (start: SeasonDraft, source: RunState, catalogRef: Catalog): { draft: SeasonDraft; card: MomentCard | null } => {
    let draft = start;
    for (let guard = 0; draft.phase === 'moment' && guard < 8; guard++) {
      const stop = draft.stops[draft.stopIndex] as number;
      const card = pickMoment({
        bank: bank.current ?? { templates: [], skipped: [] },
        catalog: catalogRef,
        draft,
        seed: source.seed,
        stop,
        recent: recentMoments(),
        playerName: 'YOU',
      });
      if (card) {
        rememberMoment(card.id);
        return { draft, card };
      }
      draft = passStop(draft, Math.random);
    }
    return { draft, card: null };
  };

  const stagedRun = (draft: SeasonDraft, source: RunState, catalogRef: Catalog): RunState => {
    const { draft: next, card } = advanceDraft(draft, source, catalogRef);
    if (next.phase === 'done') {
      const season = finalizeDraft(next, { playerName: 'YOU', rng: Math.random, displayRng: Math.random });
      return { ...source, draft: null, moment: null, season };
    }
    return { ...source, draft: next, moment: card, season: null };
  };

  const simulateFor = async (active: RunState, update: (next: RunState) => void) => {
    if (!active.team || !catalog) return;
    const team = active.team;
    const build = { position: active.position, era: active.era, picks: active.picks };
    const withoutMoments = () => {
      writeMomentsOff(true);
      setMomentsOff(true);
      update({ ...active, draft: null, moment: null, season: finalizeDraft(startSeason({ build, team, seed: active.seed, rng: Math.random, moments: false }), { playerName: 'YOU', rng: Math.random, displayRng: Math.random }), screen: 'season' });
    };
    if (momentsOff) {
      withoutMoments();
      return;
    }
    try {
      if (!bank.current) bank.current = await loadMomentBank(active.position);
    } catch {
      bank.current = null;
      setNotice('Season moments could not load. Playing without them.');
      withoutMoments();
      return;
    }
    const draft = startSeason({ build, team, seed: active.seed, rng: Math.random, moments: true });
    update({ ...stagedRun(draft, active, catalog), screen: 'season' });
  };

  const toggleMoments = () => {
    const next = !momentsOff;
    setMomentsOff(next);
    writeMomentsOff(next);
  };

  const openDaily = () => {
    const day = daily ?? dailyDay(plan.key);
    setDaily(day);
    setConfirmLeave(false);
    setDailyPlaying(false);
    setFlow('daily');
  };

  const startDaily = () => {
    const day = daily ?? dailyDay(plan.key);
    const next =
      day.run ??
      createRun(plan.seed, plan.pos === 'big' ? 'big' : 'guard', plan.mode === 'all-time' ? 'alltime' : 'current');
    const saved: DailyDay = { ...day, run: next, spins: next.spinIndex };
    saveDailyDay(saved);
    setDaily(saved);
    setConfirmLeave(false);
    setDailyPlaying(true);
    setFlow('daily');
  };

  const commitDaily = (next: RunState) => {
    const day = daily ?? dailyDay(plan.key);
    const saved: DailyDay = { ...day, run: next, spins: next.spinIndex };
    saveDailyDay(saved);
    setDaily(saved);
  };

  const leaveDaily = (forfeit: boolean) => {
    const day = daily ?? dailyDay(plan.key);
    if (forfeit && day.run && !day.done) {
      const saved: DailyDay = { ...day, done: true, forfeit: true, ovr: null, run: null, spins: 0 };
      saveDailyDay(saved);
      setDaily(saved);
    }
    setConfirmLeave(false);
    setDailyPlaying(false);
    setFlow('classic');
  };

  const dailyDone = flow === 'daily' && daily?.run?.screen === 'end' && Boolean(daily.run.season);
  useEffect(() => {
    if (!dailyDone || !daily?.run?.season || daily.done) return;
    const saved: DailyDay = { ...daily, done: true, forfeit: false, ovr: daily.run.season.ovr, run: daily.run };
    saveDailyDay(saved);
    setDaily(saved);
  }, [dailyDone, daily]);

  if (!catalog) {
    return (
      <div class="app">
        <div class="screen">
          <div class="body" style={{ justifyContent: 'center' }}>
            {loadError ? (
              <>
                <div class="notice bad">{loadError}</div>
                <button class="btn" onClick={() => setAttempt((value) => value + 1)}>
                  Retry
                </button>
              </>
            ) : (
              <p class="muted center">Loading player data…</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const dailyStrip = (
    <div class="daily-strip" data-testid="daily-strip">
      <span class="ticker-dot" />
      <span class="tiny">DAILY · {plan.pos.toUpperCase()} · {plan.mode === 'all-time' ? 'ALL-TIME' : 'CURRENT'}</span>
      <span class="top-spacer" />
      <button class="icon-btn wide" onClick={() => setConfirmLeave((value) => !value)}>
        LEAVE
      </button>
    </div>
  );

  const dailyConfirm = confirmLeave ? (
    <div class="notice bad" data-testid="daily-leave">
      Leaving ends today's challenge: no score, and you can't play it again until tomorrow.
      <span class="row" style={{ marginTop: '6px' }}>
        <button class="btn btn-small" data-testid="daily-leave-confirm" onClick={() => leaveDaily(true)}>
          Leave anyway
        </button>
        <button class="btn btn-ghost btn-small" onClick={() => setConfirmLeave(false)}>
          Stay
        </button>
      </span>
    </div>
  ) : null;

  const renderRun = (
    active: RunState,
    update: (next: RunState) => void,
    back: () => void,
    header?: ComponentChildren,
    simulateNow?: () => void,
  ) => {
    if (active.screen === 'builder') {
      return <Builder run={active} catalog={catalog} onChange={update} onBack={back} header={header} />;
    }
    if (active.screen === 'team') {
      return (
        <TeamSpin
          run={active}
          catalog={catalog}
          onChange={update}
          onSimulate={simulateNow ?? (() => update({ ...active, screen: 'team' }))}
          onBack={back}
          header={header}
        />
      );
    }
    if (active.screen === 'season' && (active.season || active.draft)) {
      return (
        <Season
          run={active}
          moment={active.moment}
          momentsOff={momentsOff}
          onChoose={(optionId) => {
            if (!active.draft || !active.moment) return;
            const option = active.moment.options.find((entry) => entry.id === optionId);
            if (!option) return;
            const next = chooseMoment(active.draft, { momentId: active.moment.id, optionId, effect: option.effect }, Math.random);
            update({ ...stagedRun(next, active, catalog), screen: 'season' });
          }}
          onToggleMoments={toggleMoments}
          onAdvance={() => update({ ...active, screen: (active.season?.seed ?? 15) <= 10 ? 'playoffs' : 'end' })}
        />
      );
    }
    if (active.screen === 'playoffs' && active.season) {
      return <Playoffs season={active.season} onAdvance={() => update({ ...active, screen: 'end' })} />;
    }
    if (active.screen === 'end' && active.season) {
      return <End run={active} onNewBuild={() => (flow === 'daily' ? leaveDaily(false) : back())} />;
    }
    return null;
  };

  const body = () => {
    if (flow === 'daily') {
      const day = daily ?? dailyDay(plan.key);
      if (!day.run || (day.done && !dailyPlaying)) {
        return (
          <LazyScreen
            load={loadDaily}
            screenProps={{ plan, day, catalog, onPlay: startDaily, onExit: () => setFlow('classic') }}
          />
        );
      }
      return renderRun(day.run, commitDaily, () => setConfirmLeave(true), <>{dailyStrip}{dailyConfirm}</>, () => void simulateFor(day.run as RunState, commitDaily));
    }
    if (flow === 'squad') {
      return <LazyScreen load={loadSquad} screenProps={{ catalog, onExit: () => setFlow('classic') }} />;
    }
    if (flow === 'salary') {
      return <LazyScreen load={loadSalary} screenProps={{ catalog, plan, onExit: () => setFlow('classic') }} />;
    }
    if (flow === 'career') {
      return <LazyScreen load={loadCareer} screenProps={{ catalog, onExit: () => setFlow('classic') }} />;
    }
    if (!run) {
      return (
        <Home
          onStart={start}
          onCreateLobby={(name) => setMpEntry({ kind: 'create', name, code: '' })}
          onJoinLobby={(name, code) => setMpEntry({ kind: 'join', name, code })}
          notice={notice}
          mpNotice={mpNotice}
          onDaily={openDaily}
          onSalary={() => setFlow('salary')}
          onSquad={() => setFlow('squad')}
          onCareer={() => setFlow('career')}
          careerLabel={careerHint()}
          dailyLabel={`${plan.pos.toUpperCase()} · ${plan.mode === 'all-time' ? 'ALL-TIME' : 'CURRENT'}${daily?.done ? (daily.forfeit ? ' · left today' : ` · ${daily.ovr} OVR`) : ''}`}
          dailyStatus={plan.key}
        />
      );
    }
    return renderRun(
      run,
      commit,
      () => {
        clearRun();
        setRun(null);
      },
      undefined,
      () => void simulateFor(run, commit),
    );
  };

  return (
    <div class="app">
      <ErrorBoundary>
        {mpEntry ? (
          <LazyScreen
            load={loadLobby}
            screenProps={{
              catalog,
              initial: mpEntry,
              onExit: (message: string | null) => {
                setMpEntry(null);
                if (message) setMpNotice(message);
              },
            }}
          />
        ) : (
          body()
        )}
      </ErrorBoundary>
    </div>
  );
}
