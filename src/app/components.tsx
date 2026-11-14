import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ATTR_LABELS, BIG_ATTRS, GUARD_ATTRS, gradeTone, valueLabel } from '../shared/engine/rules';
import type { RunState } from '../shared/run';

export function TopBar(props: { title: string; onBack?: () => void; right?: ComponentChildren }) {
  return (
    <div class="top">
      {props.onBack ? (
        <button class="icon-btn" aria-label="Back" onClick={props.onBack}>
          ‹
        </button>
      ) : null}
      <span class="top-title">{props.title}</span>
      <span class="top-spacer" />
      {props.right}
    </div>
  );
}

export function Avatar(props: { photo?: string | null; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const size = props.size ?? 40;
  const initials = props.name
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0] ?? '')
    .slice(-2)
    .join('')
    .toUpperCase();
  return (
    <div class="avatar" style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.36)}px` }}>
      {props.photo && !failed ? (
        <img src={props.photo} width={size} height={size} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

export function YouTag() {
  return <span class="you-tag">YOU</span>;
}

export function SlotGrid(props: { run: RunState; showGrades: boolean }) {
  const attrs: readonly string[] = props.run.position === 'guard' ? GUARD_ATTRS : BIG_ATTRS;
  return (
    <div class="slots">
      {attrs.map((attr) => {
        const pick = props.run.picks[attr];
        const meta = ATTR_LABELS[attr];
        const label = pick ? valueLabel(pick.val, props.showGrades) : '—';
        const tone = pick && props.showGrades ? gradeTone(label) : '';
        return (
          <div class={`slot ${pick ? 'filled' : ''}`} key={attr}>
            <Avatar photo={pick?.photo} name={pick?.playerName ?? ''} size={22} />
            <span class="slot-key">{meta?.short ?? attr}</span>
            <span class="slot-name">{pick ? pick.playerName : meta?.label}</span>
            <span class={`slot-val ${tone}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function StatGrid(props: { items: Array<{ label: string; value: string | number }>; className?: string }) {
  return (
    <div class={`stat-grid${props.className ? ` ${props.className}` : ''}`}>
      {props.items.map((item, index) => (
        <div class="stat" key={`${item.label}-${index}`}>
          <b>{item.value}</b>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export interface StandingRow {
  key: string;
  seed?: number | null;
  team: string;
  name?: string | null;
  wins: number;
  losses?: number;
  isMine?: boolean;
}

export function StandingsTable(props: {
  rows: StandingRow[];
  showSeed?: boolean;
  showLosses?: boolean;
  showGB?: boolean;
  compact?: boolean;
}) {
  const leader = props.rows.reduce((best, row) => Math.max(best, row.wins), 0);
  return (
    <div class={`table${props.showSeed ? ' seeded' : ''}${props.showGB ? ' gb' : ''}${props.compact ? ' compact' : ''}`}>
      <div class="table-row head">
        {props.showSeed ? <span class="table-seed">#</span> : null}
        <span class="table-team">TEAM</span>
        <span class="table-wins">{props.showLosses ? 'W-L' : 'W'}</span>
        {props.showGB ? <span class="table-gb">GB</span> : null}
      </div>
      {props.rows.map((row) => (
        <div class={`table-row${row.isMine ? ' us' : ''}`} key={row.key}>
          {props.showSeed ? <span class="table-seed">{row.seed ?? '—'}</span> : null}
          <span class="table-team">
            <b>{row.team}</b>
            {row.name ? <span class="table-name">{row.name}</span> : null}
            {row.isMine ? <YouTag /> : null}
          </span>
          <span class="table-wins">
            {row.wins}
            {props.showLosses ? `-${row.losses ?? 0}` : ''}
          </span>
          {props.showGB ? <span class="table-gb">{row.wins === leader ? '—' : leader - row.wins}</span> : null}
        </div>
      ))}
    </div>
  );
}
