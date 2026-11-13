import JSON5 from 'json5';
import * as v from 'valibot';
import { DATA_BASE } from '../engine/rules.js';
import type { Player, Position, Era, Team } from '../engine/types.js';
import { HeadshotSchema, PlayerListSchema, SalaryLegendListSchema, TeamListSchema } from './schemas.js';

export interface Catalog {
  teams: Team[];
  currentGuards: Player[];
  currentBigs: Player[];
  legendGuards: Player[];
  legendBigs: Player[];
  salaryLegends: Player[];
  headshots: Record<string, string>;
}

const FILES = {
  guards: 'src/data/nba-guards.js',
  bigs: 'src/data/nba-bigs.js',
  legendGuards: 'src/data/nba-guard-legends.js',
  legendBigs: 'src/data/nba-big-legends.js',
  salaryLegends: 'src/data/nba-salary.js',
  teams: 'src/data/nba-teams.js',
  headshots: 'src/data/nba-headshots.json',
} as const;

const CACHE_NAME = 'bab-data-v1';
const TIMEOUT_MS = 8000;
export const GENERIC_LIGHT = `${DATA_BASE}/public/genericlight.webp`;
export const GENERIC_DARK = `${DATA_BASE}/public/genericdark.webp`;

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataError';
  }
}

async function readCached(url: string): Promise<string | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    return hit ? await hit.text() : null;
  } catch {
    return null;
  }
}

async function writeCached(url: string, text: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, new Response(text));
  } catch {
    return;
  }
}

export async function fetchSource(path: string): Promise<string> {
  const url = `${DATA_BASE}/${path}`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new DataError(`HTTP ${response.status} for ${path}`);
      const text = await response.text();
      await writeCached(url, text);
      return text;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new DataError(`Could not load ${path}: ${lastError instanceof Error ? lastError.message : 'network error'}`);
}

export function extractLiteral(source: string, name: string): string {
  const identifier = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`export\\s+const\\s+${identifier}(?![\\w$])`).exec(source);
  if (!match) throw new DataError(`Missing export ${name}`);
  let index = source.indexOf('=', match.index + match[0].length);
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

function tryParseExport<T>(source: string, name: string, schema: v.GenericSchema<T>): T | null {
  try {
    return parseExport(source, name, schema);
  } catch {
    return null;
  }
}

async function loadExport<T>(path: string, name: string, schema: v.GenericSchema<T>): Promise<T> {
  const cached = await readCached(`${DATA_BASE}/${path}`);
  if (cached !== null) {
    const parsed = tryParseExport(cached, name, schema);
    if (parsed !== null) return parsed;
  }
  return parseExport(await fetchSource(path), name, schema);
}

async function loadHeadshots(): Promise<Record<string, string>> {
  const parse = (text: string): Record<string, string> | null => {
    try {
      const parsed = v.safeParse(HeadshotSchema, JSON.parse(text));
      return parsed.success ? parsed.output : null;
    } catch {
      return null;
    }
  };
  const cached = await readCached(`${DATA_BASE}/${FILES.headshots}`);
  if (cached !== null) {
    const value = parse(cached);
    if (value) return value;
  }
  return parse(await fetchSource(FILES.headshots)) ?? {};
}

export async function loadCatalog(): Promise<Catalog> {
  const [teams, currentGuards, currentBigs, legendGuards, legendBigs, salaryLegends, headshots] = await Promise.all([
    loadExport(FILES.teams, 'NBA_TEAMS', TeamListSchema),
    loadExport(FILES.guards, 'NBA_GUARD_PLAYERS', PlayerListSchema),
    loadExport(FILES.bigs, 'NBA_BIG_PLAYERS', PlayerListSchema),
    loadExport(FILES.legendGuards, 'NBA_ALLTIME_GUARD_PLAYERS', PlayerListSchema),
    loadExport(FILES.legendBigs, 'NBA_ALLTIME_BIG_PLAYERS', PlayerListSchema),
    loadExport(FILES.salaryLegends, 'GOAT_SALARY_PLAYERS', SalaryLegendListSchema),
    loadHeadshots(),
  ]);
  return {
    teams,
    currentGuards,
    currentBigs,
    legendGuards,
    legendBigs,
    salaryLegends: salaryLegends.map((player) => ({
      ...player,
      short: player.short ?? player.name.split(' ').slice(-1)[0] ?? player.name,
    })) as Player[],
    headshots,
  };
}

export function parseAges(source: string): Record<string, number> | null {
  const table = JSON5.parse(extractLiteral(source, 'BIRTH_NBA')) as Record<string, unknown> | null;
  if (!table || typeof table !== 'object') return null;
  const clean: Record<string, number> = {};
  for (const [name, year] of Object.entries(table)) {
    if (typeof year === 'number' && Number.isFinite(year)) clean[name] = year;
  }
  return Object.keys(clean).length ? clean : null;
}

export async function loadCareerAges(): Promise<Record<string, number> | null> {
  const path = 'src/data/player-ages.js';
  const cached = await readCached(`${DATA_BASE}/${path}`);
  if (cached !== null) {
    const ages = tryAges(cached);
    if (ages) return ages;
  }
  try {
    return parseAges(await fetchSource(path));
  } catch {
    return null;
  }
}

function tryAges(source: string): Record<string, number> | null {
  try {
    return parseAges(source);
  } catch {
    return null;
  }
}

export function poolFor(catalog: Catalog, position: Position, era: Era): Player[] {
  if (era === 'alltime') return position === 'guard' ? catalog.legendGuards : catalog.legendBigs;
  return position === 'guard' ? catalog.currentGuards : catalog.currentBigs;
}

export function headshotFor(catalog: Catalog, player: Player): string | null {
  const id = catalog.headshots[player.name];
  return id ? `${DATA_BASE}/public/headshots/nba/${id}.webp` : null;
}

function luminance(hex: string | undefined): number | null {
  if (!hex) return null;
  const value = hex.trim().replace(/^#/, '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function photoFor(catalog: Catalog, player: Player): string {
  const shot = headshotFor(catalog, player);
  if (shot) return shot;
  const level = luminance(player.skin);
  return level !== null && level > 155 ? GENERIC_LIGHT : GENERIC_DARK;
}
