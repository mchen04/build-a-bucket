import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Catalog } from '../shared/data/loader';
import { headshotFor } from '../shared/data/loader';
import { ATTR_LABELS, gradeFor } from '../shared/engine/rules';
import type { Player } from '../shared/engine/types';
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

export function Avatar(props: { catalog: Catalog; player: Player; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = headshotFor(props.catalog, props.player);
  const initials = props.player.short.slice(0, 2).toUpperCase();
  return (
    <div class="avatar" style={props.size ? { width: `${props.size}px`, height: `${props.size}px` } : undefined}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

export function SlotGrid(props: { run: RunState }) {
  const attrs = props.run.position === 'guard'
    ? ['jumpShot', 'finishing', 'passing', 'handles', 'perimeterDefense', 'speed', 'bounce', 'size', 'basketballIQ', 'clutch']
    : ['jumpShot', 'finishing', 'rebounding', 'playmaking', 'interiorDefense', 'speed', 'bounce', 'size', 'basketballIQ', 'clutch'];
  return (
    <div class="slots">
      {attrs.map((attr) => {
        const pick = props.run.picks[attr];
        const meta = ATTR_LABELS[attr];
        return (
          <div class={`slot ${pick ? 'filled' : ''}`} key={attr}>
            <span class="slot-key">{meta?.short ?? attr}</span>
            <span class="slot-val">{pick ? gradeFor(pick.val) : '—'}</span>
            <span class="slot-name">{pick ? pick.playerShort : ''}</span>
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
