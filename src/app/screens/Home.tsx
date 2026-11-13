import { useState } from 'preact/hooks';
import type { Era, Position } from '../../shared/engine/types';

export function Home(props: { onStart: (position: Position, era: Era) => void; notice: string | null }) {
  const [position, setPosition] = useState<Position>('guard');
  const [era, setEra] = useState<Era>('current');
  return (
    <div class="screen">
      <div class="top">
        <span class="top-title">Build a Bucket</span>
        <span class="top-spacer" />
        <span class="tiny muted">Rebuild</span>
      </div>
      <div class="body">
        {props.notice ? <div class="notice bad">{props.notice}</div> : null}
        <div>
          <div class="hero">BUILD A<br />BUCKET</div>
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
              <div class="name">Squad Builder</div>
              <div class="sub">Build your whole team</div>
            </div>
            <span class="lock">Coming in this rebuild</span>
          </div>
          <div class="home-item">
            <div style={{ flex: 1 }}>
              <div class="name">Blacktop · Compete · Versus</div>
              <div class="sub">Live multiplayer is not available in this rebuild yet.</div>
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
