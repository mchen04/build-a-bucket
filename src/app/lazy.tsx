import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';

interface Props<P extends object> {
  load: () => Promise<ComponentType<P>>;
  screenProps: P;
}

export function LazyScreen<P extends object>({ load, screenProps }: Props<P>) {
  const [Screen, setScreen] = useState<ComponentType<P> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setScreen(null);
    load()
      .then((value) => {
        if (alive) setScreen(() => value);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [load]);

  if (failed) {
    return (
      <div class="screen">
        <div class="body" style={{ justifyContent: 'center' }}>
          <div class="notice bad">This mode could not load. Check your connection and try again.</div>
        </div>
      </div>
    );
  }

  if (!Screen) {
    return (
      <div class="screen">
        <div class="body" style={{ justifyContent: 'center' }}>
          <p class="muted center">Loading…</p>
        </div>
      </div>
    );
  }

  return <Screen {...screenProps} />;
}
