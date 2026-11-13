import { useState } from 'preact/hooks';
import type { HistoryEntry, SlotSummary } from '../../../shared/careerStore';
import { TopBar } from '../../components';

export interface NewCareerForm {
  pos: 'guard' | 'big';
  name: string;
  games: 'simple' | 'off';
}

interface Props {
  slots: (SlotSummary | null)[];
  history: HistoryEntry[];
  onResume: (index: number) => void;
  onDelete: (index: number) => void;
  onCreate: (form: NewCareerForm) => void;
  onExit: () => void;
  notice?: string | null;
}

export function CareerHome({ slots, history, onResume, onDelete, onCreate, onExit, notice }: Props) {
  const [creating, setCreating] = useState(false);
  const [pos, setPos] = useState<'guard' | 'big'>('guard');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [games, setGames] = useState<'simple' | 'off'>('off');
  const name = `${first.trim()} ${last.trim()}`.trim();
  const ready = first.trim().length >= 2 && last.trim().length >= 2 && name.length <= 14;


  return (
    <div class="screen">
      <TopBar title="Career" onBack={onExit} right={<span class="tiny muted">5 slots</span>} />
      <div class="body">
        {notice ? <div class="notice">{notice}</div> : null}
        {!creating ? (
          <>
            <div class="home-list" data-testid="career-slots">
              {slots.map((summary, index) => (
                <div class="home-item" key={index} data-testid={`career-slot-${index}`}>
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    <span class="name">{summary ? summary.name : 'Empty slot'}</span>
                    <span class="sub">
                      {summary ? `${summary.team ?? 'no team'} · age ${summary.age} · ${summary.ovr} OVR` : 'Start a player, build him, live the career'}
                    </span>
                  </span>
                  {summary ? (
                    <span class="row">
                      <button class="icon-btn wide" onClick={() => onResume(index)}>
                        {summary.phase === 'retired' ? 'View' : 'Resume'}
                      </button>
                      <button class="icon-btn wide" onClick={() => onDelete(index)}>
                        Delete
                      </button>
                    </span>
                  ) : (
                    <button class="icon-btn wide" data-testid={`career-new-${index}`} onClick={() => setCreating(true)}>
                      New
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button class="btn" data-testid="career-new" onClick={() => setCreating(true)}>
              New career
            </button>
            {history.length ? (
              <div class="card" data-testid="career-history">
                <div class="tiny muted">FINISHED CAREERS</div>
                {history.slice(0, 20).map((entry, index) => (
                  <div class="row" key={`${entry.seed}-${index}`} style={{ justifyContent: 'space-between' }}>
                    <span class="tiny">
                      {entry.name} · {entry.seasons} seasons
                    </span>
                    <span class="tiny muted">
                      {entry.rings} {entry.rings === 1 ? 'ring' : 'rings'} · {entry.awards} MVP · {entry.legacy} legacy
                      {entry.hof ? ' · HOF' : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div class="card" data-testid="career-form">
            <div class="tiny muted">NEW CAREER</div>
            <div class="seg" style={{ marginTop: '6px' }}>
              <button aria-pressed={pos === 'guard'} onClick={() => setPos('guard')}>
                Guard
              </button>
              <button aria-pressed={pos === 'big'} onClick={() => setPos('big')}>
                Big
              </button>
            </div>
            <div class="row" style={{ marginTop: '6px' }}>
              <input
                class="field"
                data-testid="career-first"
                placeholder="First name"
                maxLength={14}
                value={first}
                onInput={(event) => setFirst((event.target as HTMLInputElement).value)}
              />
              <input
                class="field"
                data-testid="career-last"
                placeholder="Last name"
                maxLength={14}
                value={last}
                onInput={(event) => setLast((event.target as HTMLInputElement).value)}
              />
            </div>
            <div class="tiny muted" style={{ marginTop: '8px' }}>
              MINI GAMES
            </div>
            <div class="seg">
              <button aria-pressed={games === 'off'} data-testid="career-games-off" onClick={() => setGames('off')}>
                Simulated
              </button>
              <button aria-pressed={games === 'simple'} data-testid="career-games-simple" onClick={() => setGames('simple')}>
                Simple
              </button>
              <button aria-pressed={false} disabled>
                Advanced
              </button>
            </div>
            <div class="notice" style={{ marginTop: '6px' }}>
              Advanced mini games (the original's 3D canvas games) are not rebuilt; Simulated plays every moment out
              on the odds, Simple gives you a timing bar.
            </div>
            <div class="row" style={{ marginTop: '8px' }}>
              <button class="btn btn-ghost btn-small" onClick={() => setCreating(false)}>
                Back
              </button>
              <button class="btn" data-testid="career-start" disabled={!ready} onClick={() => onCreate({ pos, name, games })}>
                Build the player
              </button>
            </div>
          </div>
        )}
      </div>
      {!creating ? (
        <div class="bottom">
          <button class="btn" onClick={() => setCreating(true)}>
            New career
          </button>
        </div>
      ) : null}
    </div>
  );
}

