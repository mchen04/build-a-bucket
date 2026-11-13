import { startSeason, finalizeDraft, teamStrength } from '../../src/shared/engine/season';
import { archetypeFor } from '../../src/shared/engine/archetype';
import { dailyPlanFor } from '../../src/shared/engine/daily';
import { computeOvr } from '../../src/shared/engine/ovr';
import { mulberry32 } from '../../src/shared/engine/rng';
import {
  SAL_COLUMNS,
  budgetForDateStr,
  buildFromCards,
  dailyGrid,
  infiniteGrid,
  previewFor,
  salaryPool,
  spentFor,
  teamForSeed,
  yesterdaySeedOf,
  type SalCard,
} from '../../src/shared/engine/salary';
import { CURRENT_TEAMS } from '../../src/shared/engine/rules';
import { scoutGrade, shuffleColumn, shuffleRow } from '../../src/shared/engine/salaryPowers';
import { spinTarget, teamCandidates } from '../../src/shared/engine/spin';
import { squadSeason, squadStarters, squadStrength, type SquadBuild } from '../../src/shared/engine/squad';
import type { Build as SeasonBuild, Player, Position } from '../../src/shared/engine/types';

export interface AttrTypes {
  guard: string[];
  big: string[];
}

export interface Pools {
  guards: Player[];
  bigs: Player[];
  legendGuards: Player[];
  legendBigs: Player[];
  legends: Player[];
  teams: string[];
}

const BUILD_VALS = [9, 7, 8, 6, 10, 5, 7, 8, 9, 6];
const SQUAD_VALS = [
  [9, 7, 8, 6, 10, 5, 7, 8, 9, 6],
  [6, 8, 7, 9, 5, 10, 6, 7, 8, 9],
  [7, 7, 7, 7, 7, 7, 7, 7, 7, 7],
  [8, 9, 10, 5, 9, 4, 6, 10, 7, 6],
  [5, 10, 9, 4, 10, 3, 5, 11, 6, 7],
];

function valuesFor(pos: Position, types: AttrTypes, row: number[]): Record<string, number> {
  const attrs = pos === 'big' ? types.big : types.guard;
  return Object.fromEntries(attrs.map((attr, index) => [attr, row[index] ?? 5]));
}

function picksFor(values: Record<string, number>): SeasonBuild['picks'] {
  return Object.fromEntries(
    Object.entries(values).map(([attr, val]) => [attr, { attr, val, playerName: '', playerShort: '', team: '' }]),
  );
}

function poolFor(pools: Pools, pos: string, mode: string): Player[] {
  if (pos === 'big') return mode === 'all-time' ? pools.legendBigs : pools.bigs;
  return mode === 'all-time' ? pools.legendGuards : pools.guards;
}

export function ovrCase(types: AttrTypes): unknown {
  const out: Record<string, { ovr: number; arch: string }> = {};
  for (const pos of ['guard', 'big'] as const) {
    const picks = picksFor(valuesFor(pos, types, BUILD_VALS));
    const ovr = computeOvr(picks, pos);
    out[pos] = { ovr, arch: archetypeFor(ovr, picks, pos) };
  }
  return out;
}

export function spinCase(pools: Pools, seeds: string[], pos: Position, count: number): unknown {
  const pool = poolFor(pools, pos, 'classic');
  const rows = seeds.map((seed) => {
    const spins: (string | null)[][] = [];
    for (let index = 0; index < count; index++) {
      const dealt = spinTarget(pool, seed, index, false, 0, `${seed}:r`);
      const respun = spinTarget(pool, seed, index, false, 1, `${seed}:r`);
      spins.push([dealt?.team ?? null, dealt?.player.name ?? null, respun?.player.name ?? null]);
    }
    return { seed, spins };
  });
  return { pos, mode: 'classic', reel: teamCandidates(pool), poolSize: pool.length, rows };
}

export function dailyCase(pools: Pools, types: AttrTypes, dates: string[]): unknown {
  const rows = dates.map((key) => {
    const plan = dailyPlanFor(key);
    const row: Record<string, unknown> = {
      key,
      dc: { key: plan.key, sport: plan.sport, pos: plan.pos, mode: plan.mode, seed: plan.seed },
    };
    if (plan.sport === 'bucket') {
      const pool = poolFor(pools, plan.pos, plan.mode);
      const attrs = plan.pos === 'big' ? types.big : types.guard;
      row.spins = attrs.map((_, index) => {
        const target = spinTarget(pool, plan.seed, index, false, 0, `${plan.seed}:r`);
        return [target?.team ?? null, target?.player.name ?? null];
      });
      const picks: SeasonBuild['picks'] = {};
      (row.spins as (string | null)[][]).forEach(([team, name], index) => {
        const attr = attrs[index] as string;
        const player = pool.find((entry) => entry.team === team && entry.name === name);
        picks[attr] = {
          attr,
          val: player?.attrs?.[attr] ?? 5,
          playerName: name ?? '',
          playerShort: '',
          team: team ?? '',
        };
      });
      row.check = { ovr: computeOvr(picks, plan.pos as Position) };
    }
    return row;
  });
  return { rows };
}

export function seasonCase(pools: Pools, seeds: string[], team: string, types: AttrTypes): unknown {
  const build: SeasonBuild = {
    position: 'guard',
    era: 'current',
    picks: picksFor(valuesFor('guard', types, BUILD_VALS)),
  };
  const rows = seeds.map((seed) => {
    const rng = mulberry32(Number(seed));
    const draft = startSeason({ build, team, seed: build.era, rng, moments: false });
    const result = finalizeDraft(draft, { playerName: 'YOU', rng, displayRng: rng });
    return {
      seed: Number(seed),
      ovr: result.ovr,
      wins: result.wins,
      losses: result.losses,
      confSeed: result.seed,
      champion: result.champion,
      madePlayoffs: result.madePlayoffs,
      line: [result.ppg, result.rpg, result.apg, result.spg, result.bpg, result.fgPct, result.threePct, result.ftPct, result.tov, result.per],
      rounds: result.playoffRounds.map((round) => [
        round.type,
        round.opponent?.short ?? null,
        round.type === 'series' ? round.won : round.advanced,
        round.type === 'series' ? round.wins : null,
        round.type === 'series' ? round.losses : null,
      ]),
      mvp: result.mvp,
      dpoy: result.dpoy,
    };
  });
  return {
    team,
    teamWP: pools.teams.map((short) => [short, teamStrength(short, CURRENT_TEAMS as unknown as Parameters<typeof teamStrength>[1])]),
    rows,
  };
}

export function salaryCase(pools: Pools, dates: string[]): unknown {
  const pool = salaryPool(pools.guards, pools.bigs, pools.legends);
  const rows = dates.map((date) => {
    const grid = dailyGrid(SAL_COLUMNS, pool, date);
    const picks = [1, 2, 3, 4, 4]
      .map((tier, column) => grid[column]?.[tier])
      .filter((card): card is SalCard => Boolean(card));
    const seed = Number(date.replace(/-/g, ''));
    const preview = previewFor(picks);
    return {
      date,
      budget: budgetForDateStr(date),
      yesterdaySeed: yesterdaySeedOf(date),
      grid: grid.map((column) => column.map((card) => `${card.price}:${card.name}`)),
      infinite: infiniteGrid(SAL_COLUMNS, pool, seed).map((column) => column[0]?.name ?? null),
      preview,
      spent: spentFor(picks),
      build: buildFromCards(picks).values,
      salaryTeam: teamForSeed(seed, pools.teams),
    };
  });
  return {
    rows,
    teams: pools.teams,
    pool: pool.map((card) => ({
      name: card.name,
      team: card.team,
      number: card.number ?? null,
      attrs: card.attrs,
      posGroup: card.posGroup ?? null,
      legend: card.legend === true,
    })),
  };
}

export function powersCase(pools: Pools, date: string, drawSeed: number): unknown {
  const pool = salaryPool(pools.guards, pools.bigs, pools.legends);
  const grid = dailyGrid(SAL_COLUMNS, pool, date);
  const columns = grid.map((_, index) =>
    (shuffleColumn(grid, index, mulberry32(drawSeed))[index] ?? []).map((card) => `${card.price}:${card.name}`),
  );
  const rows = (grid[0] ?? []).map((_, tier) =>
    shuffleRow(grid, tier, mulberry32(drawSeed))
      .map((column) => column[tier])
      .filter((card): card is SalCard => Boolean(card))
      .map((card) => card.name),
  );
  const scout = [{ attrs: { finishing: 9 } }, { attrs: { handles: 6, passing: 7 } }, { attrs: {} }].map((entry) =>
    scoutGrade({ attrs: entry.attrs } as unknown as SalCard),
  );
  return { date, before: grid.map((column) => column.map((card) => card.name)), columns, rows, scout };
}

export function squadCase(pools: Pools, types: AttrTypes, seeds: string[], team: string): unknown {
  const starters = squadStarters(team, pools.guards, pools.bigs);
  const builds: SquadBuild[] = SQUAD_VALS.map((row, index) => {
    const pos: Position = index < 3 ? 'guard' : 'big';
    return { pos, values: valuesFor(pos, types, row) };
  });
  const strength = squadStrength(team, starters, builds);
  const rows = seeds.map((seed) => {
    const result = squadSeason(`${seed}-season-1`, team, { off: strength.off, def: strength.def });
    const series = result.rounds.filter((round) => round.type === 'series');
    const last = series.length > 3 ? series[3] : null;
    return {
      seed,
      strength: [Number(strength.off.toFixed(3)), Number(strength.def.toFixed(3))],
      wins: result.wins,
      losses: result.losses,
      confSeed: result.seedNumber,
      playoffs: result.madePlayoffs,
      champion: result.champion,
      finals: last ? { opponent: last.opponent, series: `${last.wins}-${last.losses}` } : null,
      rounds: result.rounds.map((round) => [round.type, round.opponent, round.wins, round.losses]),
    };
  });
  return { team, rows };
}
