import { useState } from 'preact/hooks';
import type { Era, Position } from '../../shared/engine/types';

interface Props {
  onStart: (position: Position, era: Era) => void;
  onCreateLobby: (name: string) => void;
  onJoinLobby: (name: string, code: string) => void;
  notice: string | null;
  mpNotice: string | null;
  mpBusy: boolean;
}

export function Home(props: Props) {
  const [position, setPosition] = useState<Position>('guard');
  const [era, setEra] = useState<Era>('current');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const named = name.trim().length > 0;
  const codeReady = code.trim().length >= 6;

  return (
    <div class="screen">
      <div class="top">
        <span class="top-title">Build a Bucket</span>
        <span class="top-spacer" />
        <span class="tiny muted">Rebuild</span>
      </div>
      <div class="body">
        {props.notice ? <div class="notice bad">{props.notice}</div> : null}
        {props.mpNotice ? <div class="notice bad">{props.mpNotice}</div> : null}
        <div>
          <div class="hero">
            BUILD A<br />BUCKET
          </div>
          <p class="muted" style={{ margin: '6px 0 0', fontSize: '12px' }}>
            Ten picks. One season. Make the Hall.
          </p>
        </div>
        <div class="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span class="tiny muted">Position</span>
          <div class="seg">
            <button aria-pressed={position === 'guard'} onClick={() => setPosition('guard')}>
              Guard
            </button>
            <button aria-pressed={position === 'big'} onClick={() => setPosition('big')}>
              Big
            </button>
          </div>
          <span class="tiny muted">Era</span>
          <div class="seg">
            <button aria-pressed={era === 'current'} onClick={() => setEra('current')}>
              Current
            </button>
            <button aria-pressed={era === 'alltime'} onClick={() => setEra('alltime')}>
              All-Time
            </button>
          </div>
        </div>
        <div class="card mp-home" data-testid="mp-home">
          <div class="row" style={{ alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <div class="name">Play with friends</div>
              <div class="sub">2–8 players · live lobby · invite code</div>
            </div>
          </div>
          <input
            class="field"
            data-testid="mp-name"
            placeholder="Your name"
            maxLength={16}
            autocomplete="off"
            value={name}
            onInput={(event) => setName((event.target as HTMLInputElement).value)}
          />
          <div class="row">
            <button
              class="btn btn-ghost btn-small"
              data-testid="create-lobby"
              disabled={!named || props.mpBusy}
              onClick={() => props.onCreateLobby(name.trim())}
            >
              {props.mpBusy ? 'Working…' : 'Create lobby'}
            </button>
            <input
              class="field code"
              data-testid="mp-code"
              placeholder="CODE"
              maxLength={6}
              autocomplete="off"
              autocapitalize="characters"
              value={code}
              onInput={(event) => setCode((event.target as HTMLInputElement).value.toUpperCase())}
            />
            <button
              class="btn btn-ghost btn-small"
              data-testid="join-lobby"
              disabled={!named || !codeReady || props.mpBusy}
              onClick={() => props.onJoinLobby(name.trim(), code.trim())}
            >
              Join
            </button>
          </div>
        </div>
        <div class="home-list">
          <div class="home-item">
            <div style={{ flex: 1 }}>
              <div class="name">Career</div>
              <div class="sub">Draft day to the Hall</div>
            </div>
            <span class="lock">Coming in this rebuild</span>
          </div>
          <div class="home-item">
            <div style={{ flex: 1 }}>
              <div class="name">Salary Cap</div>
              <div class="sub">Daily grid</div>
            </div>
            <span class="lock">Coming in this rebuild</span>
          </div>
          <div class="home-item">
            <div style={{ flex: 1 }}>
              <div class="name">Blacktop · Compete · Versus</div>
              <div class="sub">The original live servers are gone. Lobbies above are our multiplayer.</div>
            </div>
          </div>
        </div>
      </div>
      <div class="bottom">
        <button class="btn" onClick={() => props.onStart(position, era)}>
          Play · {position === 'guard' ? 'Guard' : 'Big'} · {era === 'current' ? 'Current' : 'All-Time'}
        </button>
      </div>
    </div>
  );
}
