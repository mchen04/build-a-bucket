import { useState } from 'preact/hooks';
import type { Era, Position } from '../../shared/engine/types';

interface ModeRow {
  title: string;
  sub: string;
  testId: string;
  onOpen: () => void;
}

interface Props {
  onStart: (position: Position, era: Era) => void;
  onCreateLobby: (name: string) => void;
  onJoinLobby: (name: string, code: string) => void;
  notice: string | null;
  mpNotice: string | null;
  onDaily: () => void;
  onSalary: () => void;
  onSquad: () => void;
  dailyLabel: string;
  dailyStatus: string;
}

export function Home(props: Props) {
  const [position, setPosition] = useState<Position>('guard');
  const [era, setEra] = useState<Era>('current');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const named = name.trim().length > 0;
  const codeReady = code.trim().length >= 6;

  const modes: ModeRow[] = [
    { title: 'Daily Challenge', sub: props.dailyLabel, testId: 'home-daily', onOpen: props.onDaily },
    { title: 'Salary Cap', sub: 'Today’s budget grid, or an infinite run', testId: 'home-salary', onOpen: props.onSalary },
    { title: 'Squad Builder', sub: 'Five builds (PG, SG, SF, PF, C) share one season', testId: 'home-squad', onOpen: props.onSquad },
  ];

  return (
    <div class="screen">
      <div class="top">
        <span class="top-title">Build a Bucket</span>
        <span class="top-spacer" />
        <span class="tiny muted">Rebuild</span>
      </div>
      <div class="body home-body">
        {props.notice ? <div class="notice bad">{props.notice}</div> : null}
        {props.mpNotice ? <div class="notice bad">{props.mpNotice}</div> : null}
        <div>
          <div class="hero home-hero">BUILD A<br />BUCKET</div>
          <p class="muted" style={{ margin: '2px 0 0', fontSize: '11px' }}>
            Ten picks. One season. Make the Hall.
          </p>
        </div>
        <div class="card home-modes">
          <div class="seg">
            <button aria-pressed={position === 'guard'} onClick={() => setPosition('guard')}>
              Guard
            </button>
            <button aria-pressed={position === 'big'} onClick={() => setPosition('big')}>
              Big
            </button>
          </div>
          <div class="seg">
            <button aria-pressed={era === 'current'} onClick={() => setEra('current')}>
              Current
            </button>
            <button aria-pressed={era === 'alltime'} onClick={() => setEra('alltime')}>
              All-Time
            </button>
          </div>
        </div>
        <div class="home-list">
          {modes.map((mode) => (
            <button class="home-item" data-testid={mode.testId} key={mode.title} onClick={mode.onOpen}>
              <span style={{ flex: 1, textAlign: 'left' }}>
                <span class="name">{mode.title}</span>
                <span class="sub">{mode.sub}</span>
              </span>
              <span class="chev">›</span>
            </button>
          ))}
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
              disabled={!named}
              onClick={() => props.onCreateLobby(name.trim())}
            >
              Create lobby
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
              disabled={!named || !codeReady}
              onClick={() => props.onJoinLobby(name.trim(), code.trim())}
            >
              Join
            </button>
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
