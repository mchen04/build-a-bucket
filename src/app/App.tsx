import { Component, type ComponentChildren } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { loadCatalog, type Catalog } from '../shared/data/loader';
import { simulateSeason } from '../shared/engine/season';
import type { Era, Position } from '../shared/engine/types';
import { randomSeed } from '../shared/engine/rng';
import { clearRun, loadRun, saveRun } from '../shared/persistence';
import { createRun, type RunState } from '../shared/run';
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

  const simulate = () => {
    if (!run || !run.team) return;
    const season = simulateSeason({
      build: { position: run.position, era: run.era, picks: run.picks },
      team: run.team,
      playerName: 'YOU',
    });
    commit({ ...run, season, screen: 'season' });
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
            onSimulate={simulate}
            onBack={() => commit({ ...run, screen: 'builder' })}
          />
        ) : run.screen === 'season' && run.season ? (
          <Season
            season={run.season}
            onAdvance={() => commit({ ...run, screen: run.season && run.season.seed <= 10 ? 'playoffs' : 'end' })}
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
