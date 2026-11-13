import { loadCatalog, poolFor, type Catalog } from '../shared/data/loader.js';
import { BIG_ATTRS, GUARD_ATTRS } from '../shared/engine/rules.js';
import { ovrFromValues } from '../shared/engine/ovr.js';
import { seededRng } from '../shared/engine/rng.js';
import {
  SAL_COLUMNS,
  budgetForSeed,
  buildFromCards,
  infiniteGrid,
  salaryPool,
  type SalCard,
} from '../shared/engine/salary.js';
import { squadStarters, squadStrength } from '../shared/engine/squad.js';
import type { Era, Pick, Position } from '../shared/engine/types.js';
import {
  ATTRS_PER_BUILD,
  SALARY_CARDS,
  SQUAD_PLAYERS,
  type BuildSummary,
  type LobbyBuild,
  type LobbySettings,
  type NormalBuild,
  type SalaryBuild,
  type SquadBuild,
} from '../shared/mp/types.js';

export interface SalaryBoard {
  grid: SalCard[][];
  budget: number;
}

export interface BuildPower {
  position: Position;
  ovr: number;
  values: Record<string, number>;
  squadStrength?: { off: number; def: number };
  squadPlayers?: { slot: string; position: Position; values: Record<string, number> }[];
}

export type BuildCheck =
  | { ok: true; build: LobbyBuild; power: BuildPower; summary: BuildSummary }
  | { ok: false; error: string };

let catalogPromise: Promise<Catalog> | null = null;

export function catalog(): Promise<Catalog> {
  if (!catalogPromise) {
    catalogPromise = loadCatalog().catch((error: unknown) => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

export function salarySeedFor(secret: string): number {
  return Math.floor(seededRng(`${secret}:salary`)() * 4294967295);
}

export function salaryBoardFor(secret: string, data: Catalog): SalaryBoard {
  const seed = salarySeedFor(secret);
  const pool = salaryPool(data.currentGuards, data.currentBigs, data.salaryLegends);
  return { grid: infiniteGrid(SAL_COLUMNS, pool, seed), budget: budgetForSeed(seed) };
}

function attrsFor(position: Position): readonly string[] {
  return position === 'guard' ? GUARD_ATTRS : BIG_ATTRS;
}

function validatePicks(
  picks: Record<string, Pick>,
  position: Position,
  era: Era,
  data: Catalog,
): string | null {
  const keys = attrsFor(position);
  const pool = poolFor(data, position, era);
  const index = new Map(pool.map((player) => [`${player.name}|${player.team}`, player]));
  for (const attr of keys) {
    const pick = picks[attr];
    if (!pick) return `Missing a pick for ${attr}.`;
    if (pick.attr !== attr) return `The ${attr} pick is inconsistent.`;
    const player = index.get(`${pick.playerName}|${pick.team}`);
    if (!player) return `${pick.playerName} is not in the ${era} ${position} pool.`;
    if (player.attrs[attr] === undefined) return `${pick.playerName} has no ${attr} rating.`;
    if (player.attrs[attr] !== pick.val) return `The ${attr} pick does not match ${pick.playerName}'s rating.`;
  }
  if (Object.keys(picks).length !== keys.length) return `A build has ${keys.length} traits.`;
  return null;
}

function valuesFromPicks(picks: Record<string, Pick>): Record<string, number> {
  return Object.fromEntries(Object.entries(picks).map(([attr, pick]) => [attr, pick.val]));
}

function latestName(build: LobbyBuild): string | null {
  if (build.kind === 'normal') {
    const picks = Object.values(build.picks);
    return picks[picks.length - 1]?.playerName ?? null;
  }
  if (build.kind === 'salary') return build.cards[build.cards.length - 1]?.name ?? null;
  const player = build.players[build.players.length - 1];
  const picks = player ? Object.values(player.picks) : [];
  return picks[picks.length - 1]?.playerName ?? null;
}

function normalBuild(build: LobbyBuild, settings: LobbySettings, data: Catalog): BuildCheck {
  if (build.kind !== 'normal') return { ok: false, error: 'This lobby uses normal builds.' };
  if (build.era !== settings.era) {
    return { ok: false, error: `This lobby plays ${settings.era === 'current' ? 'current' : 'all-time'} players.` };
  }
  const problem = validatePicks(build.picks, build.position, build.era, data);
  if (problem) return { ok: false, error: problem };
  const values = valuesFromPicks(build.picks);
  const normalized: NormalBuild = { kind: 'normal', position: build.position, era: build.era, picks: build.picks };
  return {
    ok: true,
    build: normalized,
    power: { position: build.position, ovr: ovrFromValues(values, build.position), values },
    summary: { filled: ATTRS_PER_BUILD, total: ATTRS_PER_BUILD, latest: latestName(normalized), ovr: ovrFromValues(values, build.position) },
  };
}

function salaryBuild(build: LobbyBuild, data: Catalog, secret: string): BuildCheck {
  if (build.kind !== 'salary') return { ok: false, error: 'This lobby uses salary builds.' };
  const board = salaryBoardFor(secret, data);
  const cards: SalCard[] = [];
  let spent = 0;
  for (let index = 0; index < SAL_COLUMNS.length; index++) {
    const sent = build.cards[index];
    if (!sent) return { ok: false, error: `Pick one card for ${SAL_COLUMNS[index]?.label ?? 'every column'}.` };
    const card = (board.grid[index] ?? []).find((entry) => entry.id === sent.id);
    if (!card) return { ok: false, error: `${sent.name} is not on this board.` };
    cards.push(card);
    spent += card.price;
  }
  if (spent > board.budget) return { ok: false, error: `That build costs $${spent}M against a $${board.budget}M cap.` };
  const built = buildFromCards(cards);
  const normalized: SalaryBuild = {
    kind: 'salary',
    position: built.position,
    cards: cards.map((card) => ({
      id: card.id,
      name: card.name,
      team: card.team,
      price: card.price,
      attrs: card.attrs,
      fullAttrs: card.fullAttrs,
      posGroup: card.posGroup,
    })),
  };
  return {
    ok: true,
    build: normalized,
    power: {
      position: built.position,
      ovr: ovrFromValues(built.values, built.position),
      values: built.values,
    },
    summary: { filled: cards.length, total: SALARY_CARDS, latest: latestName(normalized), ovr: ovrFromValues(built.values, built.position) },
  };
}

function squadBuild(build: LobbyBuild, settings: LobbySettings, data: Catalog, team: string): BuildCheck {
  if (build.kind !== 'squad') return { ok: false, error: 'This lobby uses squad builds.' };
  const slots = new Set(['PG', 'SG', 'SF', 'PF', 'C']);
  const seen = new Set<string>();
  const values: { slot: string; position: Position; values: Record<string, number> }[] = [];
  for (const player of build.players) {
    if (!slots.has(player.slot)) return { ok: false, error: `Unknown lineup slot ${player.slot}.` };
    if (seen.has(player.slot)) return { ok: false, error: `Two players share the ${player.slot} slot.` };
    seen.add(player.slot);
    const problem = validatePicks(player.picks, player.position, settings.era, data);
    if (problem) return { ok: false, error: problem };
    values.push({ slot: player.slot, position: player.position, values: valuesFromPicks(player.picks) });
  }
  if (seen.size !== SQUAD_PLAYERS) return { ok: false, error: 'A squad has five players.' };
  const starters = squadStarters(
    team,
    settings.era === 'alltime' ? data.legendGuards : data.currentGuards,
    settings.era === 'alltime' ? data.legendBigs : data.currentBigs,
  );
  const strength = squadStrength(
    team,
    starters,
    values.map((entry) => ({ pos: entry.position, values: entry.values })),
    settings.era,
  );
  const ranked = [...values].sort(
    (a, b) => ovrFromValues(b.values, b.position) - ovrFromValues(a.values, a.position),
  );
  const best = ranked[0] ?? { position: 'guard' as Position, values: {} };
  const normalized: SquadBuild = {
    kind: 'squad',
    players: build.players.map((player) => ({
      slot: player.slot,
      position: player.position,
      picks: player.picks,
    })),
  };
  return {
    ok: true,
    build: normalized,
    power: {
      position: best.position,
      ovr: Math.round(values.reduce((sum, entry) => sum + ovrFromValues(entry.values, entry.position), 0) / SQUAD_PLAYERS),
      values: best.values,
      squadStrength: { off: strength.off, def: strength.def },
      squadPlayers: values,
    },
    summary: {
      filled: values.length,
      total: SQUAD_PLAYERS,
      latest: latestName(normalized),
      ovr: Math.round(values.reduce((sum, entry) => sum + ovrFromValues(entry.values, entry.position), 0) / SQUAD_PLAYERS),
    },
  };
}

export function validateBuild(
  build: LobbyBuild,
  settings: LobbySettings,
  data: Catalog,
  team: string,
  secret: string,
): BuildCheck {
  if (settings.mode === 'normal') return normalBuild(build, settings, data);
  if (settings.mode === 'salary') return salaryBuild(build, data, secret);
  return squadBuild(build, settings, data, team);
}

export function powerFromBuild(build: LobbyBuild, settings: LobbySettings, data: Catalog, team: string): BuildPower {
  if (build.kind === 'salary') {
    const built = buildFromCards(build.cards as SalCard[]);
    return { position: built.position, ovr: ovrFromValues(built.values, built.position), values: built.values };
  }
  if (build.kind === 'squad') {
    const values = build.players.map((player) => ({
      slot: player.slot,
      position: player.position,
      values: valuesFromPicks(player.picks),
    }));
    const starters = squadStarters(
      team,
      settings.era === 'alltime' ? data.legendGuards : data.currentGuards,
      settings.era === 'alltime' ? data.legendBigs : data.currentBigs,
    );
    const strength = squadStrength(
      team,
      starters,
      values.map((entry) => ({ pos: entry.position, values: entry.values })),
      settings.era,
    );
    const ranked = [...values].sort((a, b) => ovrFromValues(b.values, b.position) - ovrFromValues(a.values, a.position));
    const best = ranked[0] ?? { position: 'guard' as Position, values: {} };
    return {
      position: best.position,
      ovr: Math.round(values.reduce((sum, entry) => sum + ovrFromValues(entry.values, entry.position), 0) / SQUAD_PLAYERS),
      values: best.values,
      squadStrength: { off: strength.off, def: strength.def },
      squadPlayers: values,
    };
  }
  const values = valuesFromPicks(build.picks);
  return { position: build.position, ovr: ovrFromValues(values, build.position), values };
}
