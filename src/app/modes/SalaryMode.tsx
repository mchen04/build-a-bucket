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
import { scoutGrade, shuffleColumn, shuffleRow, type ShuffleTarget } from '../../shared/engine/salaryPowers';
import { seasonHeadline, simulateSeason } from '../../shared/engine/season';
import type { Build } from '../../shared/engine/types';
import { bumpInfinite, cardSummary, readSalary, saveSalaryPlay, saveSalaryPowers } from '../../shared/salaryStore';
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

  const [grid, setGrid] = useState<SalCard[][] | null>(() => {
    const saved = readSalary().powers[plan.key]?.grid ?? null;
    if (saved) return saved;
    return pool.length ? dailyGrid(SAL_COLUMNS, pool, plan.key) : null;
  });
  const [powers, setPowers] = useState<{ shuffle: boolean; scout: boolean }>(() => {
    const saved = readSalary().powers[plan.key] ?? null;
    return { shuffle: saved?.shuffle ?? false, scout: saved?.scout ?? false };
  });
  const [scouted, setScouted] = useState<Record<string, string>>(() => readSalary().powers[plan.key]?.scouted ?? {});
  const [shuffleArmed, setShuffleArmed] = useState(false);
  const [scoutMode, setScoutMode] = useState(false);
  const [powersOpen, setPowersOpen] = useState(false);

  const cap = mode === 'daily' ? budgetForDateStr(plan.key) : budgetForSeed(seed);
  const locked = play?.locked === true;
  const powersLocked = locked || (mode === 'infinite' && play !== null);

  const persist = (
    nextPowers: { shuffle: boolean; scout: boolean },
    nextGrid: SalCard[][] | null,
    nextScouted: Record<string, string>,
  ) => {
    if (mode !== 'daily') return;
    saveSalaryPowers(plan.key, { ...nextPowers, grid: nextGrid, scouted: nextScouted });
  };

  const toggleMode = () => {
    const next = mode === 'daily' ? 'infinite' : 'daily';
    setMode(next);
    setNotice(null);
    setShuffleArmed(false);
    setScoutMode(false);
    setPowersOpen(false);
    if (next === 'daily') {
      setSeed(Number(plan.key.replace(/-/g, '')));
      const saved = readSalary().daily[plan.key] ?? null;
      setPlay(saved ? { ...saved, locked: true, dateStr: plan.key } : null);
      const savedPowers = readSalary().powers[plan.key] ?? null;
      setPowers({ shuffle: savedPowers?.shuffle ?? false, scout: savedPowers?.scout ?? false });
      setScouted(savedPowers?.scouted ?? {});
      setGrid(savedPowers?.grid ?? (pool.length ? dailyGrid(SAL_COLUMNS, pool, plan.key) : null));
    } else {
      const nextSeed = Math.floor(Math.random() * 0x7fffffff);
      setSeed(nextSeed);
      setPlay(null);
      setPowers({ shuffle: false, scout: false });
      setScouted({});
      setGrid(pool.length ? infiniteGrid(SAL_COLUMNS, pool, nextSeed) : null);
    }
  };

  const armShuffle = () => {
    if (powersLocked || powers.shuffle) return;
    setPowersOpen(false);
    setScoutMode(false);
    setShuffleArmed((armed) => !armed);
  };

  const armScout = () => {
    if (powersLocked || powers.scout) return;
    setPowersOpen(false);
    setShuffleArmed(false);
    setScoutMode((armed) => !armed);
  };

  const applyShuffle = (target: ShuffleTarget) => {
    if (!grid || powersLocked || powers.shuffle) return;
    const nextGrid =
      target.kind === 'column' ? shuffleColumn(grid, target.index, Math.random) : shuffleRow(grid, target.tier, Math.random);
    const oldIds = new Map<string, string>();
    for (const column of grid) for (const card of column) oldIds.set(card.name, card.id);
    const nextScouted: Record<string, string> = {};
    for (const column of nextGrid) {
      for (const card of column) {
        const oldId = oldIds.get(card.name);
        if (oldId && scouted[oldId]) nextScouted[card.id] = scoutGrade(card);
      }
    }
    const nextPowers = { ...powers, shuffle: true };
    setGrid(nextGrid);
    setScouted(nextScouted);
    setPowers(nextPowers);
    setShuffleArmed(false);
    persist(nextPowers, nextGrid, nextScouted);
  };

  const revealScout = (card: SalCard) => {
    if (powersLocked || powers.scout) return;
    const nextScouted = { ...scouted, [card.id]: scoutGrade(card) };
    const nextPowers = { ...powers, scout: true };
    setScouted(nextScouted);
    setPowers(nextPowers);
    setScoutMode(false);
    persist(nextPowers, grid, nextScouted);
  };

  const confirm = (cards: SalCard[]) => {
    setShuffleArmed(false);
    setScoutMode(false);
    setPowersOpen(false);
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
      powers={powers}
      powersDisabled={powersLocked}
      scouted={scouted}
      shuffleArmed={shuffleArmed}
      scoutMode={scoutMode}
      powersOpen={powersOpen}
      onTogglePowers={() => setPowersOpen((open) => !open)}
      onArmShuffle={armShuffle}
      onArmScout={armScout}
      onCancelPower={() => {
        setShuffleArmed(false);
        setScoutMode(false);
      }}
      onShuffle={applyShuffle}
      onScout={revealScout}
      onToggleMode={toggleMode}
      onConfirm={confirm}
      onExit={onExit}
    />
  );
}
