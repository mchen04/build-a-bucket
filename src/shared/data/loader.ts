import JSON5 from 'json5';
import * as v from 'valibot';
import { DATA_BASE } from '../engine/rules';
import type { Player, Position, Era, Team } from '../engine/types';
import { HeadshotSchema, PlayerListSchema, TeamListSchema } from './schemas';

export interface Catalog {
  teams: Team[];
  currentGuards: Player[];
  currentBigs: Player[];
  legendGuards: Player[];
  legendBigs: Player[];
  headshots: Record<string, string>;
}

const FILES = {
  guards: 'src/data/nba-guards.js',
  bigs: 'src/data/nba-bigs.js',
  legendGuards: 'src/data/nba-guard-legends.js',
  legendBigs: 'src/data/nba-big-legends.js',
  teams: 'src/data/nba-teams.js',
  headshots: 'src/data/nba-headshots.json',
} as const;

const CACHE_NAME = 'bab-data-v1';
const TIMEOUT_MS = 8000;

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataError';
  }
}

async function fetchText(path: string): Promise<string> {
  const url = `${DATA_BASE}/${path}`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new DataError(`HTTP ${response.status} for ${path}`);
      const text = await response.text();
      if (typeof caches !== 'undefined') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(url, new Response(text));
      }
      return text;
    } catch (error) {
      lastError = error;
      if (typeof caches !== 'undefined') {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(url);
        if (cached) return cached.text();
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new DataError(`Could not load ${path}: ${lastError instanceof Error ? lastError.message : 'network error'}`);
}

export function extractLiteral(source: string, name: string): string {
  const marker = `export const ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new DataError(`Missing export ${name}`);
  let index = source.indexOf('=', start + marker.length);
  if (index < 0) throw new DataError(`Missing value for ${name}`);
  index++;
  while (index < source.length && /\s/.test(source[index] as string)) index++;
  const open = source[index];
  if (open !== '[' && open !== '{') throw new DataError(`Unsupported literal for ${name}`);
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = index; i < source.length; i++) {
    const char = source[i] as string;
    const next = source[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return source.slice(index, i + 1);
    }
  }
  throw new DataError(`Unterminated literal for ${name}`);
}

function parseExport<T>(source: string, name: string, schema: v.GenericSchema<T>): T {
  const literal = extractLiteral(source, name);
  let value: unknown;
  try {
    value = JSON5.parse(literal);
  } catch (error) {
    throw new DataError(`Could not parse ${name}: ${error instanceof Error ? error.message : 'invalid'}`);
  }
  const result = v.safeParse(schema, value);
  if (!result.success) throw new DataError(`Invalid ${name}: ${result.issues[0]?.message ?? 'schema'}`);
  return result.output;
}

export async function loadCatalog(): Promise<Catalog> {
  const [guardsText, bigsText, legendGuardsText, legendBigsText, teamsText, headshotsText] = await Promise.all([
    fetchText(FILES.guards),
    fetchText(FILES.bigs),
    fetchText(FILES.legendGuards),
    fetchText(FILES.legendBigs),
    fetchText(FILES.teams),
    fetchText(FILES.headshots),
  ]);
  let headshots: Record<string, string> = {};
  try {
    const parsed = v.safeParse(HeadshotSchema, JSON.parse(headshotsText));
    if (parsed.success) headshots = parsed.output;
  } catch {
    headshots = {};
  }
  return {
    teams: parseExport(teamsText, 'NBA_TEAMS', TeamListSchema),
    currentGuards: parseExport(guardsText, 'NBA_GUARD_PLAYERS', PlayerListSchema),
    currentBigs: parseExport(bigsText, 'NBA_BIG_PLAYERS', PlayerListSchema),
    legendGuards: parseExport(legendGuardsText, 'NBA_ALLTIME_GUARD_PLAYERS', PlayerListSchema),
    legendBigs: parseExport(legendBigsText, 'NBA_ALLTIME_BIG_PLAYERS', PlayerListSchema),
    headshots,
  };
}

export function poolFor(catalog: Catalog, position: Position, era: Era): Player[] {
  if (era === 'alltime') return position === 'guard' ? catalog.legendGuards : catalog.legendBigs;
  return position === 'guard' ? catalog.currentGuards : catalog.currentBigs;
}

export function teamFor(catalog: Catalog, short: string): Team | undefined {
  return catalog.teams.find((team) => team.short === short);
}

export function headshotFor(catalog: Catalog, player: Player): string | null {
  const id = catalog.headshots[player.name];
  return id ? `${DATA_BASE}/public/headshots/nba/${id}.webp` : null;
}
