import { useEffect, useState } from 'preact/hooks';
import type { SalCard, SalColumn } from '../../shared/engine/salary';
import { SAL_COLUMNS } from '../../shared/engine/salary';
import type { ShuffleTarget } from '../../shared/engine/salaryPowers';
import { TopBar } from '../components';

export interface SalaryOutcome {
  dateStr: string;
  cap: number;
  spent: number;
  ovr: number;
  wins: number;
  losses: number;
  seed: number;
  champion: boolean;
  madePlayoffs: boolean;
  headline: string;
  preview: { overall: number; ppg: number; apg: number; rpg: number };
  locked: boolean;
}

interface Props {
  mode: 'daily' | 'infinite';
  dateStr: string;
  cap: number;
  grid: SalCard[][];
  play: SalaryOutcome | null;
  notice: string | null;
  powers: { shuffle: boolean; scout: boolean };
  scouted: Record<string, string>;
  shuffleArmed: boolean;
  scoutMode: boolean;
  powersOpen: boolean;
  onTogglePowers: () => void;
  onArmShuffle: () => void;
  onArmScout: () => void;
  onShuffle: (target: ShuffleTarget) => void;
  onScout: (card: SalCard) => void;
  onToggleMode: () => void;
  onConfirm: (cards: SalCard[]) => void;
  onExit: () => void;
}

function lastName(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  return parts.length > 1 ? (parts.slice(1).join(' ')) : name;
}

export function Salary(props: Props) {
  const [picked, setPicked] = useState<Record<number, SalCard>>({});
  const columns: SalColumn[] = SAL_COLUMNS;
  const cards = columns.map((_, index) => picked[index]).filter(Boolean) as SalCard[];
  const spent = cards.reduce((sum, card) => sum + card.price, 0);
  const complete = cards.length === columns.length;
  const over = spent > props.cap;
  const locked = props.play?.locked === true;
  const play = props.play;

  useEffect(() => {
    setPicked((current) => {
      const next: Record<number, SalCard> = {};
      for (const [index, card] of Object.entries(current)) {
        const columnIndex = Number(index);
        if (props.grid[columnIndex]?.some((entry) => entry.id === card.id)) next[columnIndex] = card;
      }
      return next;
    });
  }, [props.grid]);

  const choose = (columnIndex: number, card: SalCard) => {
    if (locked) return;
    if (props.scoutMode) {
      props.onScout(card);
      return;
    }
    setPicked((current) => {
      const next = { ...current };
      if (next[columnIndex]?.id === card.id) delete next[columnIndex];
      else next[columnIndex] = card;
      return next;
    });
  };

  return (
    <div class="screen">
      <TopBar
        title="Salary Cap"
        onBack={props.onExit}
        right={
          <div class="sc-powers">
            <button class="icon-btn wide" data-testid="salary-powers" disabled={locked} onClick={props.onTogglePowers}>
              POWERS
            </button>
            <button class="icon-btn wide" data-testid="salary-mode" onClick={props.onToggleMode}>
              {props.mode === 'daily' ? 'DAILY' : 'INFINITE'}
            </button>
          </div>
        }
      />
      <div class="body">
        {props.notice ? <div class="notice bad">{props.notice}</div> : null}
        {props.powersOpen && !locked ? (
          <div class="card" data-testid="salary-powers-menu">
            <div class="tiny muted">POWERS · one use each today</div>
            <div class="sc-power-row">
              <button
                class="btn btn-small sc-power"
                data-testid="salary-power-shuffle"
                disabled={props.powers.shuffle}
                onClick={props.onArmShuffle}
              >
                SHUFFLE <span class="sc-badge" data-testid="salary-power-shuffle-badge">{props.powers.shuffle ? 0 : 1}</span>
              </button>
              <button
                class="btn btn-small sc-power"
                data-testid="salary-power-scout"
                disabled={props.powers.scout}
                onClick={props.onArmScout}
              >
                SCOUT <span class="sc-badge" data-testid="salary-power-scout-badge">{props.powers.scout ? 0 : 1}</span>
              </button>
            </div>
          </div>
        ) : null}
        {props.shuffleArmed ? (
          <div class="notice" data-testid="salary-shuffle-hint">
            Tap a column header or a price row.
          </div>
        ) : null}
        {props.scoutMode ? (
          <div class="notice" data-testid="salary-scout-hint">
            Tap a card to reveal its grade.
          </div>
        ) : null}
        <div class="sc-bar" data-testid="salary-cap">
          <span class="sc-spent" style={{ color: over ? 'var(--bad)' : 'inherit' }}>
            ${spent}M
          </span>
          <span class="sc-cap">/ ${props.cap}M</span>
          <span class="tiny muted" style={{ marginLeft: 'auto' }}>
            {props.mode === 'daily' ? props.dateStr : `SEED ${props.dateStr}`}
          </span>
        </div>
        <div class={`sc-grid${props.shuffleArmed ? ' targeting' : ''}`} data-testid="salary-grid">
          <div class="sc-head" />
          {columns.map((column, columnIndex) =>
            props.shuffleArmed ? (
              <button
                class="sc-head sc-target"
                key={column.key}
                data-testid={`salary-shuffle-column-${column.key}`}
                onClick={() => props.onShuffle({ kind: 'column', index: columnIndex })}
              >
                {column.label.split(' ')[0]}
              </button>
            ) : (
              <div class="sc-head" key={column.key}>
                {column.label.split(' ')[0]}
              </div>
            ),
          )}
          {[0, 1, 2, 3, 4].map((tier) => (
            <div class="sc-row" key={tier} style={{ display: 'contents' }}>
              {props.shuffleArmed ? (
                <button
                  class="sc-price sc-target"
                  data-testid={`salary-shuffle-row-${tier}`}
                  onClick={() => props.onShuffle({ kind: 'row', tier })}
                >
                  ${[50, 40, 30, 20, 10][tier]}M
                </button>
              ) : (
                <div class="sc-price">${[50, 40, 30, 20, 10][tier]}M</div>
              )}
              {columns.map((column, columnIndex) => {
                const card = props.grid[columnIndex]?.[tier];
                if (!card) return <div class="sc-cell" key={column.key} />;
                const on = picked[columnIndex]?.id === card.id;
                const grade = props.scouted[card.id];
                return (
                  <button
                    class={`sc-cell${on ? ' on' : ''}${card.legend ? ' legend' : ''}${props.scoutMode ? ' scouting' : ''}`}
                    key={`${column.key}-${tier}`}
                    data-testid={`salary-${column.key}-${tier}`}
                    aria-pressed={on}
                    onClick={() => choose(columnIndex, card)}
                  >
                    <span class="sc-name">{lastName(card.name)}</span>
                    <span class="sc-team">{card.legend ? `${card.team} · GOAT` : card.team}</span>
                    {grade ? (
                      <span class="sc-grade" data-testid={`salary-grade-${column.key}-${tier}`}>
                        {grade}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {play ? (
          <div class="card" data-testid="salary-result">
            <div class="tiny muted">{play.locked ? 'TODAY IS LOCKED IN' : 'SEASON RESULT'}</div>
            <div class="title" style={{ marginTop: '2px' }}>
              {play.headline}
            </div>
            <div class="muted" style={{ fontSize: '11px', marginTop: '4px' }}>
              OVR {play.ovr} · {play.wins}-{play.losses} · {play.champion ? 'CHAMPIONS' : play.madePlayoffs ? 'PLAYOFFS' : 'MISSED PLAYOFFS'} · ${play.spent}M
            </div>
            <div class="tiny muted" style={{ marginTop: '2px' }}>
              PREVIEW {play.preview.ppg} PPG · {play.preview.rpg} RPG · {play.preview.apg} APG
            </div>
          </div>
        ) : (
          <div class="notice" data-testid="salary-hint">
            Pick one card per column. The cap is ${props.cap}M and the season is seeded from {props.mode === 'daily' ? props.dateStr : 'the run seed'}.
          </div>
        )}
      </div>
      <div class="bottom">
        <button class="btn" data-testid="salary-confirm" disabled={!complete || over || locked} onClick={() => props.onConfirm(cards)}>
          {locked ? 'Already played today' : over ? `Over the cap by $${spent - props.cap}M` : complete ? 'Play the season' : 'Pick one per column'}
        </button>
      </div>
    </div>
  );
}
