import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { gradeTone, valueLabel } from '../../shared/engine/rules';
import type { SalaryCardPick, SalaryPowersView } from '../../shared/mp/types';
import { TopBar } from '../components';

interface Props {
  board: SalaryCardPick[][];
  budget: number;
  busy: boolean;
  powers: SalaryPowersView | null;
  header?: ComponentChildren;
  onBack: () => void;
  onSubmit: (cards: SalaryCardPick[]) => void;
  onPower: (
    power: 'shuffle' | 'scout',
    target: { kind: 'column'; index: number } | { kind: 'row'; tier: number } | { cardId: string },
  ) => void;
}

export function LobbySalary(props: Props) {
  const [picked, setPicked] = useState<(SalaryCardPick | null)[]>(() => props.board.map(() => null));
  const [shuffleArmed, setShuffleArmed] = useState(false);
  const [scoutMode, setScoutMode] = useState(false);
  const spent = picked.reduce((sum, card) => sum + (card?.price ?? 0), 0);
  const remaining = props.budget - spent;
  const complete = picked.every((card) => card !== null);
  const powers = props.powers;

  useEffect(() => {
    setPicked((current) =>
      props.board.map((column, index) => {
        const card = current[index];
        return card && column.some((entry) => entry.id === card.id) ? card : null;
      }),
    );
  }, [props.board]);

  const choose = (column: number, card: SalaryCardPick) => {
    if (scoutMode) {
      setScoutMode(false);
      props.onPower('scout', { cardId: card.id });
      return;
    }
    setPicked((current) => current.map((entry, index) => (index === column ? (entry?.id === card.id ? null : card) : entry)));
  };

  const shuffle = (target: { kind: 'column'; index: number } | { kind: 'row'; tier: number }) => {
    setShuffleArmed(false);
    props.onPower('shuffle', target);
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
        {powers ? (
          <div class="card">
            <div class="tiny muted">Powers</div>
            <div class="row" style={{ marginTop: '4px' }}>
              <button
                class="btn btn-ghost btn-small"
                data-testid="lobby-salary-shuffle"
                disabled={props.busy || powers.shuffle}
                onClick={() => {
                  setScoutMode(false);
                  setShuffleArmed((armed) => !armed);
                }}
              >
                Shuffle {powers.shuffle ? '· used' : '· 1'}
              </button>
              <button
                class="btn btn-ghost btn-small"
                data-testid="lobby-salary-scout"
                disabled={props.busy || powers.scout}
                onClick={() => {
                  setShuffleArmed(false);
                  setScoutMode((armed) => !armed);
                }}
              >
                Scout {powers.scout ? '· used' : '· 1'}
              </button>
            </div>
            {shuffleArmed ? (
              <>
                <div class="tiny muted">Pick a column or row.</div>
                <div class="row" style={{ flexWrap: 'wrap' }}>
                  {[50, 40, 30, 20, 10].map((price, tier) => (
                    <button
                      class="btn btn-ghost btn-small"
                      key={price}
                      data-testid={`lobby-salary-shuffle-row-${tier}`}
                      onClick={() => shuffle({ kind: 'row', tier })}
                    >
                      ${price}M
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {scoutMode ? <div class="tiny muted">Pick a card.</div> : null}
          </div>
        ) : null}
        {props.board.map((column, columnIndex) => (
          <div class="card" key={columnIndex} style={{ display: 'grid', gap: '4px' }}>
            {shuffleArmed ? (
              <button
                class="btn btn-ghost btn-small"
                data-testid={`lobby-salary-shuffle-column-${columnIndex}`}
                onClick={() => shuffle({ kind: 'column', index: columnIndex })}
              >
                {column[0]?.posGroup === 'big' ? 'BIG' : 'GUARD'} {columnIndex + 1}
              </button>
            ) : (
              <div class="tiny muted">{column[0]?.posGroup === 'big' ? 'BIG' : 'GUARD'} · column {columnIndex + 1}</div>
            )}
            <div class="row" style={{ flexWrap: 'wrap' }}>
              {column.map((card) => {
                const active = picked[columnIndex]?.id === card.id;
                const grade = powers?.scouted[card.id];
                return (
                  <button
                    class={`chip${active ? ' on' : ''}`}
                    key={card.id}
                    aria-pressed={active}
                    onClick={() => choose(columnIndex, card)}
                    style={{ flex: '1 1 30%', minWidth: '92px' }}
                  >
                    <span class="card-name">{card.name}</span>
                    <span class="tiny muted">{card.team} · {card.price}M</span>
                    <span class="card-attrs">
                      {Object.entries(card.attrs).map(([key, value]) => {
                        const label = valueLabel(value, true);
                        return (
                          <span class="card-attr" key={key}>
                            <span class="card-attr-key">{key.slice(0, 3).toUpperCase()}</span>
                            <span class={`card-attr-val ${gradeTone(label)}`}>{label}</span>
                          </span>
                        );
                      })}
                    </span>
                    {grade ? <span class={`sc-grade ${gradeTone(grade)}`}>{grade}</span> : null}
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

