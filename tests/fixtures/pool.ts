import type { Pick, Player } from '../../src/shared/engine/types';

export const GUARD_KEYS = [
  'jumpShot',
  'finishing',
  'passing',
  'handles',
  'perimeterDefense',
  'speed',
  'bounce',
  'size',
  'basketballIQ',
  'clutch',
] as const;

export const BIG_KEYS = [
  'jumpShot',
  'finishing',
  'rebounding',
  'playmaking',
  'interiorDefense',
  'speed',
  'bounce',
  'size',
  'basketballIQ',
  'clutch',
] as const;

export const POOL: Player[] = [
  { name: 'Ada Fox', short: 'Fox', team: 'AAA', attrs: { jumpShot: 9 } },
  { name: 'Ben Ortiz', short: 'Ortiz', team: 'AAA', attrs: { jumpShot: 4 } },
  { name: 'Cy Marsh', short: 'Marsh', team: 'BBB', attrs: { jumpShot: 7 } },
  { name: 'Dee Novak', short: 'Novak', team: 'BBB', attrs: { jumpShot: 2 } },
  { name: 'Eli Pike', short: 'Pike', team: 'CCC', attrs: { jumpShot: 6 } },
  { name: 'Fay Quinn', short: 'Quinn', team: 'CCC', attrs: { jumpShot: 1 } },
  { name: 'Gus Reed', short: 'Reed', team: 'CCC', attrs: { jumpShot: 11 } },
];

export function picksFor(keys: readonly string[], values: Record<string, number>): Record<string, Pick> {
  const picks: Record<string, Pick> = {};
  for (const key of keys) {
    picks[key] = {
      attr: key,
      val: values[key] ?? 6,
      playerName: `Test ${key}`,
      playerShort: key.slice(0, 4),
      team: 'AAA',
    };
  }
  return picks;
}
