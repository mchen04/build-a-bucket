import { Component, type ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { loadCatalog, type Catalog } from '../shared/data/loader';
import { loadMomentBank, type MomentBank } from '../shared/data/moments';
import { randomSeed } from '../shared/engine/rng';
import { chooseMoment, finalizeDraft, startSeason, type SeasonDraft } from '../shared/engine/season';
import type { Era, MomentCard, Position } from '../shared/engine/types';
import { clearRun, loadRun, saveRun } from '../shared/persistence';
import { createRun, type RunState } from '../shared/run';
import { pickMoment } from './momentFlow';
import { readMomentsOff, recentMoments, rememberMoment, writeMomentsOff } from './prefs';
import { Builder } from './screens/Builder';
import { End } from './screens/End';
import { Home } from './screens/Home';
import { Playoffs } from './screens/Playoffs';
import { Season } from './screens/Season';
import { TeamSpin } from './screens/TeamSpin';

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
            <div class="notice bad">
              Something broke. Your saved run is safe. Reload to continue.
            </div>
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
  const bank = useRef<MomentBank | null>(null);

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
  }, []);

  const commit = useCallback((next: RunState) => {
    saveRun(next);
    setRun(next);
  }, []);

  const start = (position: Position, era: Era) => {
    setNotice(null);
    commit(createRun(randomSeed(), position, era));
  };

  const nextCard = (draft: SeasonDraft, source: RunState, catalogRef: Catalog): MomentCard | null => {
    if (draft.phase !== 'moment') return null;
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
    if (card) rememberMoment(card.id);
    return card;
  };

  const simulate = async () => {
    if (!run || !run.team || !catalog) return;
    const build = { position: run.position, era: run.era, picks: run.picks };
    if (momentsOff) {
      commit({ ...run, draft: null, moment: null, season: finalizeDraft(startSeason({ build, team: run.team, seed: run.seed, rng: Math.random, moments: false }), { playerName: 'YOU', rng: Math.random, displayRng: Math.random }), screen: 'season' });
      return;
    }
    try {
      if (!bank.current) bank.current = await loadMomentBank(run.position);
    } catch {
      bank.current = null;
      setNotice('Season moments could not load. Playing without them.');
      writeMomentsOff(true);
      setMomentsOff(true);
      commit({ ...run, draft: null, moment: null, season: finalizeDraft(startSeason({ build, team: run.team, seed: run.seed, rng: Math.random, moments: false }), { playerName: 'YOU', rng: Math.random, displayRng: Math.random }), screen: 'season' });
      return;
    }
    const draft = startSeason({ build, team: run.team, seed: run.seed, rng: Math.random, moments: true });
    const withCard = { ...run, draft, moment: null, season: null, screen: 'season' as const };
    commit({ ...withCard, moment: nextCard(draft, withCard, catalog) });
  };

  const choose = (optionId: string) => {
    if (!run?.draft || !run.moment) return;
    const option = run.moment.options.find((entry) => entry.id === optionId);
    if (!option) return;
    const next = chooseMoment(run.draft, { momentId: run.moment.id, optionId, effect: option.effect }, Math.random);
    if (next.phase === 'done') {
      const season = finalizeDraft(next, { playerName: 'YOU', rng: Math.random, displayRng: Math.random });
      commit({ ...run, draft: null, moment: null, season, screen: 'season' });
      return;
    }
    const staged = { ...run, draft: next, moment: null };
    commit({ ...staged, moment: catalog ? nextCard(next, staged, catalog) : null });
  };

  const toggleMoments = () => {
    const next = !momentsOff;
    setMomentsOff(next);
    writeMomentsOff(next);
  };

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

  return (
    <div class="app">
      <ErrorBoundary>
        {!run ? (
          <Home onStart={start} notice={notice} />
        ) : run.screen === 'builder' ? (
          <Builder
            run={run}
            catalog={catalog}
            onChange={commit}
            onBack={() => {
              clearRun();
              setRun(null);
            }}
          />
        ) : run.screen === 'team' ? (
          <TeamSpin
            run={run}
            catalog={catalog}
            onChange={commit}
            onSimulate={() => {
              void simulate();
            }}
            onBack={() => commit({ ...run, screen: 'builder' })}
          />
        ) : run.screen === 'season' && (run.season || run.draft) ? (
          <Season
            run={run}
            moment={run.moment}
            momentsOff={momentsOff}
            onChoose={choose}
            onToggleMoments={toggleMoments}
            onAdvance={() =>
              commit({ ...run, screen: (run.season?.seed ?? 15) <= 10 ? 'playoffs' : 'end' })
            }
          />
        ) : run.screen === 'playoffs' && run.season ? (
          <Playoffs season={run.season} onAdvance={() => commit({ ...run, screen: 'end' })} />
        ) : run.screen === 'end' && run.season ? (
          <End
            run={run}
            onNewBuild={() => {
              clearRun();
              setRun(null);
            }}
          />
        ) : (
          <Home onStart={start} notice={notice} />
        )}
      </ErrorBoundary>
    </div>
  );
}
