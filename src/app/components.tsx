import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ATTR_LABELS, BIG_ATTRS, GUARD_ATTRS, valueLabel } from '../shared/engine/rules';
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

export function SlotGrid(props: { run: RunState; showGrades: boolean }) {
  const attrs: readonly string[] = props.run.position === 'guard' ? GUARD_ATTRS : BIG_ATTRS;
  return (
    <div class="slots">
      {attrs.map((attr) => {
        const pick = props.run.picks[attr];
        const meta = ATTR_LABELS[attr];
        return (
          <div class={`slot ${pick ? 'filled' : ''}`} key={attr}>
            <Avatar photo={pick?.photo} name={pick?.playerName ?? ''} size={22} />
            <span class="slot-key">{meta?.short ?? attr}</span>
            <span class="slot-name">{pick ? pick.playerName : meta?.label}</span>
            <span class="slot-val">{pick ? valueLabel(pick.val, props.showGrades) : '—'}</span>
          </div>
        );
      })}
    </div>
  );
}

export function StatGrid(props: { items: Array<{ label: string; value: string | number }> }) {
  return (
    <div class="stat-grid">
      {props.items.map((item) => (
        <div class="stat" key={item.label}>
          <b>{item.value}</b>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
