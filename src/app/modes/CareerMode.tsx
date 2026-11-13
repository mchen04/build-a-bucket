import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Catalog } from '../../shared/data/loader';
import { loadCareerAges } from '../../shared/data/loader';
import type { Career, Ctx, Offer } from '../../shared/engine/career/core';
import { answerInterview, careerTeams, recordCombine, runDraft, setupInterviews } from '../../shared/engine/career/core';
import {
  acceptTalks,
  advance,
  ASKS,
  ask,
  bodyWork,
  campDrill,
  closeTalks,
  newCareer,
  nextSeason,
  openTalks,
  playMoment,
  playRound,
  retire,
  resolveInjury,
  signOffer,
  spendDev,
  startSeason,
  withCareer,
} from '../../shared/engine/career/engine';
import { randomSeed } from '../../shared/engine/rng';
import { EAST_SET, CURRENT_TEAMS } from '../../shared/engine/rules';
import type { DrillId } from '../../shared/engine/career/rules';
import { clearSlot, historyEntry, pushHistory, readHistory, readSlots, summarize, writeSlot, type HistoryEntry, type SlotSummary } from '../../shared/careerStore';
import { createRun, type RunState } from '../../shared/run';
import { Builder } from '../screens/Builder';
import { CareerDraft } from '../screens/career/CareerDraft';
import { CareerHome, type NewCareerForm } from '../screens/career/CareerHome';
import { CareerHub, type CareerActions } from '../screens/career/CareerHub';

interface Props {
  catalog: Catalog;
  onExit: () => void;
}

export function CareerMode({ catalog, onExit }: Props) {
  const [slot, setSlot] = useState<number | null>(null);
  const [career, setCareer] = useState<Career | null>(null);
  const [pending, setPending] = useState<{ form: NewCareerForm; run: RunState } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => readHistory());
  const [summaries, setSummaries] = useState<(SlotSummary | null)[]>(() => readSlots().map((entry, index) => summarize(index, entry)));
  const [birth, setBirth] = useState<Record<string, number> | null>(null);
  const [agesFailed, setAgesFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadCareerAges()
      .then((table) => {
        if (!alive) return;
        setBirth(table);
        if (!table) setAgesFailed(true);
      })
      .catch(() => {
        if (alive) setAgesFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const ctx = useMemo<Ctx>(
    () => ({
      teams: careerTeams(catalog.teams, CURRENT_TEAMS, EAST_SET),
      pools: { guards: catalog.currentGuards, bigs: catalog.currentBigs },
      birth,
    }),
    [catalog, birth],
  );

  const commit = (next: Career) => {
    setCareer(next);
    if (slot !== null) {
      writeSlot(slot, next);
      setSummaries(readSlots().map((entry, index) => summarize(index, entry)));
    }
  };

  const startBuild = (form: NewCareerForm) => {
    setPending({ form, run: createRun(randomSeed(), form.pos, 'current') });
  };

  const openSlot = (index: number) => {
    const stored = readSlots()[index] ?? null;
    setSlot(index);
    setCareer(stored);
  };

  const deleteSlot = (index: number) => {
    clearSlot(index);
    setSummaries(readSlots().map((entry, summaryIndex) => summarize(summaryIndex, entry)));
  };

  if (pending) {
    return (
      <Builder
        run={pending.run}
        catalog={catalog}
        onChange={(next) => setPending({ ...pending, run: next })}
        onBack={() => setPending(null)}
        completeLabel="Enter the draft"
        header={
          <div class="daily-strip" data-testid="career-strip">
            <span class="ticker-dot" />
            <span class="tiny">
              CAREER · {pending.form.name.toUpperCase()} · {pending.form.pos.toUpperCase()}
            </span>
          </div>
        }
        onComplete={() => {
          const build = Object.fromEntries(Object.entries(pending.run.picks).map(([attr, pick]) => [attr, { val: pick.val }]));
          const created = newCareer({ seed: pending.run.seed, pos: pending.form.pos, name: pending.form.name, build, games: pending.form.games });
          const index = summaries.findIndex((entry) => !entry);
          const target = index >= 0 ? index : 0;
          setSlot(target);
          writeSlot(target, created);
          setSummaries(readSlots().map((entry, summaryIndex) => summarize(summaryIndex, entry)));
          setPending(null);
          setCareer(created);
        }}
      />
    );
  }

  if (!career || slot === null) {
    return (
      <CareerHome
        slots={summaries}
        history={history}
        onResume={openSlot}
        onDelete={deleteSlot}
        onCreate={startBuild}
        onExit={onExit}
        notice={
          agesFailed
            ? 'Player ages could not load: roster turnover uses generated ages for this session.'
            : null
        }
      />
    );
  }

  const actions: CareerActions = {
    advance: () => commit(advance(career, ctx)),
    moment: (score) => commit(playMoment(career, score >= 0.6)),
    injury: (play) => commit(resolveInjury(career, play)),
    round: (hit) => commit(playRound(career, ctx, hit)),
    tipOff: () => commit(startSeason(career, ctx)),
    offStep: (step) => commit(withCareer({ ...career, off: { ...(career.off ?? { step, moves: [], news: [], camp: null, contract: false }), step } })),
    sign: (offer: Offer) => commit(signOffer(career, offer, ctx)),
    talks: (offer: Offer) => commit(openTalks(career, offer)),
    ask: (kind: keyof typeof ASKS) => commit(ask(career, kind)),
    acceptTalks: () => commit(acceptTalks(career, ctx)),
    closeTalks: () => commit(closeTalks(career)),
    spend: (trait) => commit(spendDev(career, trait)),
    bodyWork: () => commit(bodyWork(career)),
    camp: (score) => {
      const value = Math.max(0, Math.min(1, score));
      commit(campDrill(career, value, value >= 0.75));
    },
    nextSeason: () => commit(nextSeason(career, ctx)),
    retire: () => {
      const retired = retire(career);
      const entry = historyEntry(retired);
      const list = pushHistory(entry);
      setHistory(list);
      commit(retired);
    },
  };

  if (career.phase === 'draft') {
    return (
      <CareerDraft
        career={career}
        onDrill={(id: DrillId, score: number) => commit(recordCombine(career, id, score))}
        onAdvance={() => commit(withCareer({ ...setupInterviews(career, ctx), step: 'interviews' }))}
        onAnswer={(index, choice) => commit(answerInterview(career, index, choice))}
        onSign={() => {
          if (career.step === 'day') {
            commit(withCareer({ ...career, phase: 'preseason' }));
            return;
          }
          commit(runDraft(career, ctx));
        }}
        onExit={() => {
          setCareer(null);
          setSlot(null);
        }}
      />
    );
  }

  return (
    <CareerHub
      career={career}
      actions={actions}
      onExit={() => {
        setCareer(null);
        setSlot(null);
        setSummaries(readSlots().map((entry, index) => summarize(index, entry)));
      }}
    />
  );
}
