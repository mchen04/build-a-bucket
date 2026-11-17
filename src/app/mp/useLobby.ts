import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { mergeDelta, progressToken } from '../../shared/mp/progress';
import type { LobbyView } from '../../shared/mp/types';
import { fetchLobbyRequest, isFatal, MpError, type LobbyUpdate } from './api';
import type { MpSession } from './session';

export type LobbyStatus = 'loading' | 'live' | 'reconnecting' | 'gone';

export interface LobbyHandle {
  view: LobbyView | null;
  status: LobbyStatus;
  error: string | null;
  act: (action: (code: string, secret: string) => Promise<LobbyView>) => Promise<void>;
  refresh: () => void;
}

export function useLobby(session: MpSession | null, onGone: (message: string) => void): LobbyHandle {
  const [view, setView] = useState<LobbyView | null>(null);
  const [status, setStatus] = useState<LobbyStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const token = useRef('');
  const events = useRef(0);
  const open = useRef<LobbyView | null>(null);
  const failures = useRef(0);
  const timer = useRef<number | null>(null);
  const alive = useRef(true);
  const sessionRef = useRef(session);
  const goneRef = useRef(onGone);
  sessionRef.current = session;
  goneRef.current = onGone;

  const apply = useCallback((next: LobbyView) => {
    open.current = next;
    version.current = next.version;
    token.current = progressToken(next);
    events.current = next.events[0]?.id ?? 0;
    failures.current = 0;
    setView(next);
    setStatus('live');
    setError(null);
  }, []);

  const absorb = useCallback(
    (update: LobbyUpdate) => {
      if (update.kind === 'view') {
        apply(update.view);
        return;
      }
      const base = open.current;
      if (!base) return;
      apply(mergeDelta(base, update.delta));
    },
    [apply],
  );

  const tickRef = useRef<() => void>(() => undefined);

  const schedule = useCallback((delay: number) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => tickRef.current(), delay);
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!session) return undefined;

    const tick = async () => {
      const current = sessionRef.current;
      if (!current || !alive.current) return;
      try {
        const view = open.current;
        const waiting = view
          ? view.league?.checkpoint === true || ['lobby', 'draw', 'building', 'preview', 'rematch', 'recap'].includes(view.phase)
          : false;
        const next = await fetchLobbyRequest(
          current.code,
          current.secret,
          version.current,
          token.current,
          events.current,
          waiting,
          view?.league?.cursor ?? null,
          view?.stage ?? null,
        );
        if (!alive.current) return;
        if (next) absorb(next);
        else setStatus('live');
        const latest = open.current;
        const fast = latest?.league?.phase === 'playoffs';
        schedule(document.hidden ? 5000 : waiting ? 1000 : fast ? 350 : 1500);
      } catch (caught) {
        if (!alive.current) return;
        if (isFatal(caught)) {
          setStatus('gone');
          goneRef.current(caught instanceof MpError ? caught.message : 'This lobby is gone.');
          return;
        }
        failures.current += 1;
        setStatus('reconnecting');
        setError(caught instanceof Error ? caught.message : 'Network error');
        schedule(Math.min(8000, 1000 * 2 ** failures.current));
      }
    };

    tickRef.current = () => {
      void tick();
    };
    void tick();

    const onVisibility = () => schedule(0);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [session, absorb, schedule]);

  const act = useCallback(
    async (action: (code: string, secret: string) => Promise<LobbyView>) => {
      const current = sessionRef.current;
      if (!current) return;
      try {
        const next = await action(current.code, current.secret);
        apply(next);
      } catch (caught) {
        if (isFatal(caught)) {
          setStatus('gone');
          goneRef.current(caught instanceof MpError ? caught.message : 'This lobby is gone.');
          return;
        }
        if (!(caught instanceof MpError) || caught.status === 0 || caught.status >= 500) {
          setStatus('reconnecting');
          setError(caught instanceof Error ? caught.message : 'Network error');
          schedule(0);
        }
        throw caught;
      }
    },
    [apply, schedule],
  );

  const refresh = useCallback(() => schedule(0), [schedule]);

  return { view, status, error, act, refresh };
}
