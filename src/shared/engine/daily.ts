import type { Rng } from './rng';
import { hashRng } from './rng';

export const DAILY_EPOCH = '2026-10-23';

const NFL_POSITIONS = ['qb', 'wr', 'rb', 'db', 'te'];

export type DailySport = 'bucket' | 'nfl';

export interface DailyPlan {
  key: string;
  sport: DailySport;
  pos: string;
  mode: 'classic' | 'all-time';
  seed: string;
}

export function dayNumber(dateStr: string): number {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}

export function newYorkDayKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '01';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function dailyPlanFor(dateStr: string): DailyPlan {
  const index = dayNumber(dateStr);
  const seed = `bap-daily-${dateStr}`;
  const epoch = dayNumber(DAILY_EPOCH);
  if (dateStr < DAILY_EPOCH) {
    return {
      key: dateStr,
      sport: 'nfl',
      pos: NFL_POSITIONS[index % NFL_POSITIONS.length] as string,
      mode: Math.floor(index / NFL_POSITIONS.length) % 2 ? 'all-time' : 'classic',
      seed,
    };
  }
  const offset = index - epoch;
  const step = Math.floor(offset / 2);
  if (offset % 2) {
    return {
      key: dateStr,
      sport: 'bucket',
      pos: step % 2 ? 'big' : 'guard',
      mode: Math.floor(step / 2) % 2 ? 'all-time' : 'classic',
      seed,
    };
  }
  return {
    key: dateStr,
    sport: 'nfl',
    pos: NFL_POSITIONS[step % NFL_POSITIONS.length] as string,
    mode: Math.floor(step / NFL_POSITIONS.length) % 2 ? 'all-time' : 'classic',
    seed,
  };
}

export function dailyRng(plan: DailyPlan, purpose: string): Rng {
  return hashRng(dayNumber(plan.key) ^ hashSeed(`bap-daily-${purpose}`));
}

function hashSeed(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h | 0;
}
