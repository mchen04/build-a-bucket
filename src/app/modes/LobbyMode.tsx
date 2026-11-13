import { useEffect, useState } from 'preact/hooks';
import type { Catalog } from '../../shared/data/loader';
import { generateSecret, normalizeCode } from '../../shared/mp/codes';
import type { LobbySettings } from '../../shared/mp/types';
import { createLobbyRequest, joinLobbyRequest } from '../mp/api';
import { saveMpSession, type MpSession } from '../mp/session';
import { Lobby } from '../screens/Lobby';

export type MpEntry =
  | { kind: 'create' | 'join'; name: string; code: string }
  | { kind: 'resume'; session: MpSession };

const MP_DEFAULT_SETTINGS: LobbySettings = { era: 'current', mode: 'normal' };

interface Props {
  catalog: Catalog;
  initial: MpEntry;
  onExit: (message: string | null) => void;
}

export function LobbyMode({ catalog, initial, onExit }: Props) {
  const [session, setSession] = useState<MpSession | null>(initial.kind === 'resume' ? initial.session : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) return;
    let alive = true;
    const secret = generateSecret();
    const name = initial.kind === 'resume' ? '' : initial.name;
    const open = async () => {
      try {
        const view =
          initial.kind === 'join'
            ? await joinLobbyRequest(normalizeCode(initial.code), name, secret)
            : await createLobbyRequest(name, secret, MP_DEFAULT_SETTINGS);
        if (!alive) return;
        const next: MpSession = { v: 1, code: view.code, secret, name };
        saveMpSession(next);
        setSession(next);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Could not reach the lobby.');
      }
    };
    void open();
    return () => {
      alive = false;
    };
  }, [initial, session]);

  if (error) {
    return (
      <div class="screen">
        <div class="body" style={{ justifyContent: 'center' }}>
          <div class="notice bad">{error}</div>
          <button class="btn" onClick={() => onExit(error)}>
            Back
          </button>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div class="screen">
        <div class="body" style={{ justifyContent: 'center' }}>
          <p class="muted center">Working…</p>
        </div>
      </div>
    );
  }

  return <Lobby session={session} catalog={catalog} onExit={onExit} />;
}
