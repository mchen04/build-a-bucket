import { useState } from 'preact/hooks';
import { clamp, seededRng } from '../../../shared/engine/rng';
import type { Career, Drill } from '../../../shared/engine/career/core';
import { pickLabel, stockOf } from '../../../shared/engine/career/core';
import type { DrillId } from '../../../shared/engine/career/rules';
import { TopBar } from '../../components';
import { TimingGame } from './TimingGame';

interface Props {
  career: Career;
  onDrill: (id: DrillId, score: number) => void;
  onAdvance: () => void;
  onAnswer: (index: number, choice: number) => void;
  onSign: () => void;
  onExit: () => void;
}

const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

function band(overall: number): { round: number; part: string } {
  const { round, slot } = pickLabel(overall);
  return { round, part: slot <= 10 ? 'Early' : slot <= 20 ? 'Mid' : 'Late' };
}

function stockText(career: Career): string {
  const { lo, hi } = stockOf(career);
  const a = band(lo);
  const b = band(hi);
  if (a.round === b.round) {
    return a.part === b.part ? `${a.part} ${ordinal(a.round)} round` : `${a.part}\u2013${b.part.toLowerCase()} ${ordinal(a.round)} round`;
  }
  return `${a.part} ${ordinal(a.round)} \u2013 ${b.part.toLowerCase()} ${ordinal(b.round)} round`;
}

function offDrillScore(career: Career, drill: Drill): number {
  const trait = career.build[drill.trait]?.val ?? 5;
  const noise = seededRng(`${career.seed}-combine-${drill.id}`)();
  return clamp(0.35 + (trait / 11) * 0.55 + (noise - 0.5) * 0.3, 0.1, 1);
}

export function CareerDraft({ career, onDrill, onAdvance, onAnswer, onSign, onExit }: Props) {
  const step = career.step ?? 'combine';
  const [playing, setPlaying] = useState<DrillId | null>(null);
  const stock = stockText(career);

  if (step === 'combine') {
    const done = career.draft.combine.every((d) => d.score != null);
    const active = career.draft.combine.find((d) => d.id === playing) ?? null;
    if (active) {
      return (
        <div class="screen">
          <TopBar title={active.label} onBack={() => setPlaying(null)} />
          <div class="body">
            <TimingGame
              title={active.label}
              traitValue={career.build[active.trait]?.val ?? 5}
              onDone={(score) => {
                onDrill(active.id, score);
                setPlaying(null);
              }}
            />
          </div>
        </div>
      );
    }
    return (
      <div class="screen">
        <TopBar title="The combine" onBack={onExit} right={<span class="tiny muted">{career.ovr} OVR</span>} />
        <div class="body">
          <div class="notice" data-testid="career-stock">
            Projected: {stock}
          </div>
          <div class="home-list" data-testid="career-combine">
            {career.draft.combine.map((drill) => (
              <div class="home-item" key={drill.id}>
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <span class="name">{drill.label}</span>
                  <span class="sub">
                    {drill.text ?? 'Not run'} · {drill.trait}
                  </span>
                </span>
                {drill.score == null ? (
                  <button
                    class="icon-btn wide"
                    data-testid={`career-drill-${drill.id}`}
                    onClick={() => {
                      if (career.games === 'simple') setPlaying(drill.id);
                      else onDrill(drill.id, offDrillScore(career, drill));
                    }}
                  >
                    {career.games === 'simple' ? 'Run it' : 'Simulate'}
                  </button>
                ) : (
                  <span class="lock">{Math.round((drill.pct ?? 0) * 100)}%</span>
                )}
              </div>
            ))}
          </div>
          <div class="notice">
            {career.games === 'simple'
              ? 'Simple mini games: tap the bar inside the window. A cleaner rep moves the scouts more.'
              : 'Mini games are set to simulated: every drill is played out on the grades.'}
          </div>
        </div>
        <div class="bottom">
          <button
            class="btn"
            data-testid="career-combine-done"
            disabled={!done}
            onClick={onAdvance}
          >
            {done ? 'Sit down with the teams' : 'Run all three drills'}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'interviews') {
    const interviews = career.draft.interviews;
    const current = interviews.findIndex((entry) => entry.answer == null);
    const answered = interviews.filter((x) => x.answer != null).length;
    const entry = interviews[current >= 0 ? current : 0];
    return (
      <div class="screen">
        <TopBar title="Team interviews" onBack={onExit} right={<span class="tiny muted">{answered}/{interviews.length}</span>} />
        <div class="body" data-testid="career-interviews">
          {entry ? (
            <div class="card">
              <div class="tiny muted">
                {entry.team} · {entry.who}
              </div>
              <div style={{ fontSize: '12px', margin: '6px 0' }}>{entry.q}</div>
              {entry.a.map((answer, choice) => (
                <button
                  class={`btn btn-small ${entry.answer === choice ? '' : 'btn-ghost'}`}
                  style={{ display: 'block', width: '100%', marginBottom: '4px', textAlign: 'left' }}
                  data-testid={`career-answer-${current}-${choice}`}
                  key={choice}
                  onClick={() => onAnswer(current, choice)}
                >
                  {answer.t}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div class="bottom">
          <button class="btn" data-testid="career-interviews-done" disabled={current >= 0} onClick={onSign}>
            {current >= 0 ? `Answer ${interviews.length - answered} more` : 'Enter the draft'}
          </button>
        </div>
      </div>
    );
  }

  const pick = career.draft.pick;
  const ticker = career.draft.picks ?? [];
  return (
    <div class="screen">
      <TopBar title="Draft day" onBack={onExit} right={<span class="tiny muted">{stock}</span>} />
      <div class="body" data-testid="career-draftday">
        <div class="card">
          <div class="tiny muted">ON THE BOARD</div>
          <div class="tiny" style={{ marginTop: '4px' }}>
            {ticker
              .slice(0, 6)
              .map((entry) => `#${entry.o} ${entry.team}`)
              .join(' · ')}
          </div>
        </div>
        {pick ? (
          <div class="card" data-testid="career-pick">
            <div class="tiny muted">
              ROUND {pick.round} · PICK {pick.slot} · NO. {pick.o} OVERALL
            </div>
            <div class="title" style={{ marginTop: '2px' }}>
              {career.fit?.name ?? pick.team}
            </div>
            <div class="muted" style={{ fontSize: '11px', marginTop: '4px' }}>
              Rookie deal: {career.contract?.years} years at ${career.contract?.perYear}M
              {career.contract?.option ? ' (team option)' : ''}
            </div>
          </div>
        ) : null}
        <div class="notice">He signs the rookie deal and the season starts from the bottom of the depth chart.</div>
      </div>
      <div class="bottom">
        <button class="btn" data-testid="career-sign" onClick={onSign}>
          Sign the rookie deal
        </button>
      </div>
    </div>
  );
}

