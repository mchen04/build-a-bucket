import type { DailyDay } from '../../shared/modes';
import type { PlayoffRound, SeasonResult } from '../../shared/engine/types';
import { ATTR_LABELS, BIG_ATTRS, GUARD_ATTRS, gradeTone, valueLabel } from '../../shared/engine/rules';

export interface DailyTrait {
  attr: string;
  short: string;
  label: string;
  grade: string;
  tone: string;
  playerName: string;
  team: string;
}

export interface DailyAward {
  label: string;
  name: string;
  team: string;
  mine: boolean;
}

export interface DailyRound {
  label: string;
  opponent: string;
  result: string;
  won: boolean;
}

export interface DailyBestGame {
  opponent: string;
  mySc: number;
  oppSc: number;
  pts: number;
  reb: number;
  ast: number;
}

export interface DailyResultView {
  hasResult: boolean;
  fallback: boolean;
  forfeit: boolean;
  ovr: number | null;
  archetype: string | null;
  team: string | null;
  position: string | null;
  era: string | null;
  record: string | null;
  seed: number | null;
  per: number | null;
  stats: { label: string; value: string }[];
  awards: DailyAward[];
  finish: string;
  rounds: DailyRound[];
  run: string;
  build: DailyTrait[];
  bestGame: DailyBestGame | null;
  season: SeasonResult | null;
}

function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—';
}

export function dailyFinish(season: SeasonResult | null): string {
  if (!season) return 'No result';
  if (season.champion) return 'Champions';
  const rounds = Array.isArray(season.playoffRounds) ? season.playoffRounds : [];
  const last = rounds[rounds.length - 1];
  if (!last) return 'Missed playoffs';
  if (last.type === 'playin') return last.advanced ? 'Play-In' : 'Play-In loss';
  return last.name || 'Playoffs';
}

function roundView(round: PlayoffRound): DailyRound {
  if (round.type === 'playin') {
    return {
      label: 'Play-In',
      opponent: round.opponent?.short ?? '—',
      result: Array.isArray(round.games) ? round.games.join('-') : '—',
      won: Boolean(round.advanced),
    };
  }
  return {
    label: round.name || 'Playoffs',
    opponent: round.opponent?.short ?? '—',
    result: `${round.wins ?? 0}-${round.losses ?? 0}`,
    won: Boolean(round.won),
  };
}

export function dailyResult(day: DailyDay): DailyResultView {
  const run = day.run;
  const season = (run?.season ?? null) as SeasonResult | null;
  const picks = (run?.picks ?? {}) as Record<string, { val: number; playerName: string; team: string }>;
  const attrs = run?.position === 'big' ? BIG_ATTRS : GUARD_ATTRS;
  const build: DailyTrait[] = attrs.flatMap((attr) => {
    const pick = picks[attr];
    if (!pick) return [];
    const grade = valueLabel(pick.val, true);
    return [
      {
        attr,
        short: ATTR_LABELS[attr]?.short ?? attr,
        label: ATTR_LABELS[attr]?.label ?? attr,
        grade,
        tone: gradeTone(grade),
        playerName: pick.playerName,
        team: pick.team,
      },
    ];
  });
  const awards: DailyAward[] = [];
  if (season?.displayMvp) {
    awards.push({
      label: 'MVP',
      name: season.displayMvp.name,
      team: season.displayMvp.team ?? '',
      mine: Boolean(season.displayMvp.isPlayer),
    });
  }
  if (season?.displayDpoy) {
    awards.push({
      label: 'DPOY',
      name: season.displayDpoy.name,
      team: season.displayDpoy.team ?? '',
      mine: Boolean(season.displayDpoy.isPlayer),
    });
  }
  const stats = season
    ? [
        { label: 'PPG', value: numberText(season.ppg) },
        { label: 'RPG', value: numberText(season.rpg) },
        { label: 'APG', value: numberText(season.apg) },
        { label: 'SPG', value: numberText(season.spg) },
        { label: 'BPG', value: numberText(season.bpg) },
      ]
    : [];
  const best = season?.bestGame;
  const bestGame: DailyBestGame | null = best
    ? {
        opponent: best.opponent,
        mySc: best.mySc,
        oppSc: best.oppSc,
        pts: best.pts,
        reb: best.reb,
        ast: best.ast,
      }
    : null;
  const rounds = Array.isArray(season?.playoffRounds) ? season.playoffRounds.map(roundView) : [];
  const hasResult = day.done && (season !== null || day.ovr !== null);
  return {
    hasResult,
    fallback: !season || !run || build.length === 0,
    forfeit: day.forfeit,
    ovr: day.ovr ?? season?.ovr ?? null,
    archetype: season?.archetype ?? null,
    team: season?.team ?? run?.team ?? null,
    position: run?.position ?? season?.position ?? null,
    era: run?.era ?? null,
    record: season ? `${season.wins}-${season.losses}` : null,
    seed: typeof season?.seed === 'number' ? season.seed : null,
    per: typeof season?.per === 'number' ? season.per : null,
    stats,
    awards,
    finish: dailyFinish(season),
    rounds,
    run: Array.isArray(season?.gameLog) ? season.gameLog.join('') : '',
    build,
    bestGame,
    season,
  };
}
