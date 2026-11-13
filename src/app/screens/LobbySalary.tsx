import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { gradeFor, valueLabel } from '../../shared/engine/rules';
import type { SalaryCardPick } from '../../shared/mp/types';
import { TopBar } from '../components';

interface Props {
  board: SalaryCardPick[][];
  budget: number;
  busy: boolean;
  header?: ComponentChildren;
  onBack: () => void;
  onSubmit: (cards: SalaryCardPick[]) => void;
}

export function LobbySalary(props: Props) {
  const [picked, setPicked] = useState<(SalaryCardPick | null)[]>(() => props.board.map(() => null));
  const spent = picked.reduce((sum, card) => sum + (card?.price ?? 0), 0);
  const remaining = props.budget - spent;
  const complete = picked.every((card) => card !== null);

  const choose = (column: number, card: SalaryCardPick) => {
    setPicked((current) => current.map((entry, index) => (index === column ? (entry?.id === card.id ? null : card) : entry)));
  };

  return (
    <div class="screen">
      <TopBar title="Salary Cap" onBack={props.onBack} right={<span class="pill">{remaining}M left</span>} />
      {props.header}
      <div class="body">
        <div class="card row" style={{ alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div class="tiny muted">Cap</div>
            <div style={{ fontWeight: 900 }}>{props.budget}M</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div class="tiny muted">Spent</div>
            <div style={{ fontWeight: 900 }}>{spent}M</div>
          </div>
          <div style={{ flex: 1, textAlign: 'right' }}>
            <div class="tiny muted">Left</div>
            <div style={{ fontWeight: 900, color: remaining < 0 ? 'var(--bad)' : undefined }}>{remaining}M</div>
          </div>
        </div>
        {props.board.map((column, columnIndex) => (
          <div class="card" key={columnIndex} style={{ display: 'grid', gap: '4px' }}>
            <div class="tiny muted">{column[0]?.posGroup === 'big' ? 'BIG' : 'GUARD'} · column {columnIndex + 1}</div>
            <div class="row" style={{ flexWrap: 'wrap' }}>
              {column.map((card) => {
                const active = picked[columnIndex]?.id === card.id;
                return (
                  <button
                    class={`chip${active ? ' on' : ''}`}
                    key={card.id}
                    aria-pressed={active}
                    onClick={() => choose(columnIndex, card)}
                    style={{ flex: '1 1 30%', minWidth: '92px' }}
                  >
                    <span style={{ display: 'block', fontWeight: 800, fontSize: '11px' }}>{card.name}</span>
                    <span class="tiny muted">{card.team} · {card.price}M</span>
                    <span class="tiny">
                      {Object.entries(card.attrs)
                        .map(([key, value]) => `${key.slice(0, 3).toUpperCase()} ${valueLabel(value, true)}`)
                        .join(' · ')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div class="bottom">
        <button
          class="btn"
          disabled={!complete || remaining < 0 || props.busy}
          onClick={() => props.onSubmit(picked.filter((card): card is SalaryCardPick => card !== null))}
        >
          {props.busy ? 'Submitting…' : complete ? `Submit build · ${spent}M` : `Pick ${picked.filter(Boolean).length}/5`}
        </button>
      </div>
    </div>
  );
}

export function salaryGrade(value: number): string {
  return gradeFor(value);
}
