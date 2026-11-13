import { useMemo, useState } from 'preact/hooks';
import type { Catalog } from '../../shared/data/loader';
import type { DailyPlan } from '../../shared/engine/daily';
import { mulberry32 } from '../../shared/engine/rng';
import {
  SAL_COLUMNS,
  budgetForDateStr,
  budgetForSeed,
  buildFromCards,
  dailyGrid,
  infiniteGrid,
  previewFor,
  salaryPool,
  spentFor,
  teamForSeed,
  type SalCard,
} from '../../shared/engine/salary';
import { seasonHeadline, simulateSeason } from '../../shared/engine/season';
import type { Build } from '../../shared/engine/types';
import { bumpInfinite, cardSummary, readSalary, saveSalaryPlay } from '../../shared/salaryStore';
import { Salary, type SalaryOutcome } from '../screens/Salary';

interface Props {
  catalog: Catalog;
  plan: DailyPlan;
  onExit: () => void;
}

function picksFromValues(values: Record<string, number>, team: string): Build['picks'] {
  return Object.fromEntries(
    Object.entries(values).map(([attr, val]) => [attr, { attr, val, playerName: 'Salary Cap', playerShort: 'CAP', team }]),
  );
}

export function SalaryMode({ catalog, plan, onExit }: Props) {
  const [mode, setMode] = useState<'daily' | 'infinite'>('daily');
  const [seed, setSeed] = useState(() => Number(plan.key.replace(/-/g, '')));
  const [notice, setNotice] = useState<string | null>(null);
  const [play, setPlay] = useState<SalaryOutcome | null>(() => {
    const saved = readSalary().daily[plan.key] ?? null;
    return saved ? { ...saved, locked: true, dateStr: plan.key } : null;
  });

  const pool = useMemo(
    () => salaryPool(catalog.currentGuards, catalog.currentBigs, catalog.salaryLegends),
    [catalog],
  );

  const grid = useMemo(
    () => (pool.length ? (mode === 'daily' ? dailyGrid(SAL_COLUMNS, pool, plan.key) : infiniteGrid(SAL_COLUMNS, pool, seed)) : null),
    [pool, mode, seed, plan.key],
  );

  const cap = mode === 'daily' ? budgetForDateStr(plan.key) : budgetForSeed(seed);

  const toggleMode = () => {
    const next = mode === 'daily' ? 'infinite' : 'daily';
    setMode(next);
    setNotice(null);
    if (next === 'daily') {
      setSeed(Number(plan.key.replace(/-/g, '')));
      const saved = readSalary().daily[plan.key] ?? null;
      setPlay(saved ? { ...saved, locked: true, dateStr: plan.key } : null);
    } else {
      setSeed(Math.floor(Math.random() * 0x7fffffff));
      setPlay(null);
    }
  };

  const confirm = (cards: SalCard[]) => {
    const { position, values } = buildFromCards(cards);
    const team = teamForSeed(seed, catalog.teams.map((entry) => entry.short));
    const rand = mulberry32(seed);
    const season = simulateSeason({
      build: { position, era: 'current', picks: picksFromValues(values, team) },
      team,
      playerName: 'YOU',
      rng: rand,
      displayRng: rand,
    });
    const outcome: SalaryOutcome = {
      dateStr: mode === 'daily' ? plan.key : `SEED ${seed}`,
      cap,
      spent: spentFor(cards),
      ovr: season.ovr,
      wins: season.wins,
      losses: season.losses,
      seed,
      champion: season.champion,
      madePlayoffs: season.madePlayoffs,
      headline: seasonHeadline(season),
      preview: previewFor(cards),
      locked: mode === 'daily',
    };
    setPlay(outcome);
    if (mode === 'daily') saveSalaryPlay(plan.key, { ...outcome, picks: cardSummary(cards) });
    else bumpInfinite();
  };

  if (!grid) {
    return (
      <div class="screen">
        <div class="body" style={{ justifyContent: 'center' }}>
          <p class="muted center">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <Salary
      mode={mode}
      dateStr={mode === 'daily' ? plan.key : `#${seed}`}
      cap={cap}
      grid={grid}
      play={play}
      notice={notice}
      onToggleMode={toggleMode}
      onConfirm={confirm}
      onExit={onExit}
    />
  );
}
