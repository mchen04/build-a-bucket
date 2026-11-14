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
import { spinTarget, type SpinRecord } from '../shared/engine/spin.js';
import { SQUAD_SLOTS, squadStarters, squadStrength } from '../shared/engine/squad.js';
import type { Era, Pick, Player, Position } from '../shared/engine/types.js';
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
  type SquadPlayerBuild,
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

export interface BuildOptions {
  buildSeed?: string;
  salaryGrid?: SalCard[][];
}

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

export function buildSeedFor(secret: string, participantId: string): string {
  return `${secret}:build:${participantId}`;
}

function attrsFor(position: Position): readonly string[] {
  return position === 'guard' ? GUARD_ATTRS : BIG_ATTRS;
}

function validateSpins(
  spins: readonly SpinRecord[],
  pool: readonly Player[],
  seed: string,
  position: Position,
): string | null {
  const keys = attrsFor(position);
  if (spins.length !== keys.length) return 'The spin history is missing.';
  const seen = new Set<string>();
  let teamRespins = 0;
  let playerRespins = 0;
  for (let index = 0; index < spins.length; index++) {
    const record = spins[index] as SpinRecord;
    if (!keys.includes(record.attr)) return `${record.attr} is not a ${position} trait.`;
    if (seen.has(record.attr)) return 'The spin history repeats a trait.';
    seen.add(record.attr);
    if (record.teamRespin) teamRespins += 1;
    if (record.playerRespin) playerRespins += 1;
    const target = spinTarget(pool, seed, index, record.teamRespin, record.playerRespin ? 1 : 0, `${seed}:r`);
    if (!target) return 'The server could not reproduce that spin.';
    if (target.team !== record.team || target.player.name !== record.playerName) {
      return `Spin ${index + 1} does not match the server spin.`;
    }
  }
  if (teamRespins > 1) return 'Only one team respin is allowed.';
  if (playerRespins > 1) return 'Only one player respin is allowed.';
  return null;
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

function validateSpinPicks(
  picks: Record<string, Pick>,
  spins: readonly SpinRecord[] | undefined,
  position: Position,
  era: Era,
  data: Catalog,
  seed: string,
): string | null {
  const problem = validatePicks(picks, position, era, data);
  if (problem) return problem;
  if (!spins || spins.length === 0) return 'The spin history is missing.';
  for (const record of spins) {
    const pick = picks[record.attr];
    if (!pick) return `The spin history has no ${record.attr} pick.`;
    if (pick.playerName !== record.playerName || pick.team !== record.team) {
      return `The ${record.attr} pick does not match its spin.`;
    }
  }
  return validateSpins(spins, poolFor(data, position, era), seed, position);
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

function summaryFor(build: LobbyBuild, ovr: number, auto: boolean): BuildSummary {
  const filled = build.kind === 'normal' ? ATTRS_PER_BUILD : build.kind === 'salary' ? SALARY_CARDS : SQUAD_PLAYERS;
  return { filled, total: filled, latest: latestName(build), ovr, auto };
}

function normalBuild(build: LobbyBuild, settings: LobbySettings, data: Catalog, buildSeed: string | undefined): BuildCheck {
  if (build.kind !== 'normal') return { ok: false, error: 'This lobby uses normal builds.' };
  if (build.era !== settings.era) {
    return { ok: false, error: `This lobby plays ${settings.era === 'current' ? 'current' : 'all-time'} players.` };
  }
  if (!buildSeed) return { ok: false, error: 'This lobby has no build seed.' };
  const problem = validateSpinPicks(build.picks, build.spins, build.position, build.era, data, buildSeed);
  if (problem) return { ok: false, error: problem };
  const values = valuesFromPicks(build.picks);
  const ovr = ovrFromValues(values, build.position);
  const normalized: NormalBuild = { kind: 'normal', position: build.position, era: build.era, picks: build.picks, spins: build.spins };
  return {
    ok: true,
    build: normalized,
    power: { position: build.position, ovr, values },
    summary: summaryFor(normalized, ovr, false),
  };
}

function salaryBuild(build: LobbyBuild, data: Catalog, secret: string, grid: SalCard[][] | undefined): BuildCheck {
  if (build.kind !== 'salary') return { ok: false, error: 'This lobby uses salary builds.' };
  const board = salaryBoardFor(secret, data);
  const source = grid ?? board.grid;
  const cards: SalCard[] = [];
  let spent = 0;
  for (let index = 0; index < SAL_COLUMNS.length; index++) {
    const sent = build.cards[index];
    if (!sent) return { ok: false, error: `Pick one card for ${SAL_COLUMNS[index]?.label ?? 'every column'}.` };
    const card = (source[index] ?? []).find((entry) => entry.id === sent.id);
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
  const ovr = ovrFromValues(built.values, built.position);
  return {
    ok: true,
    build: normalized,
    power: { position: built.position, ovr, values: built.values },
    summary: summaryFor(normalized, ovr, false),
  };
}

function squadBuild(
  build: LobbyBuild,
  settings: LobbySettings,
  data: Catalog,
  team: string,
  buildSeed: string | undefined,
): BuildCheck {
  if (build.kind !== 'squad') return { ok: false, error: 'This lobby uses squad builds.' };
  if (!buildSeed) return { ok: false, error: 'This lobby has no build seed.' };
  const seen = new Set<string>();
  const values: { slot: string; position: Position; values: Record<string, number> }[] = [];
  for (const player of build.players) {
    const slot = SQUAD_SLOTS.find((entry) => entry.id === player.slot);
    if (!slot) return { ok: false, error: `Unknown lineup slot ${player.slot}.` };
    if (seen.has(player.slot)) return { ok: false, error: `Two players share the ${player.slot} slot.` };
    if (player.position !== slot.pos) return { ok: false, error: `${player.slot} must be a ${slot.pos}.` };
    seen.add(player.slot);
    const problem = validateSpinPicks(
      player.picks,
      player.spins,
      player.position,
      settings.era,
      data,
      `${buildSeed}:${player.slot}`,
    );
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
      spins: player.spins,
    })),
  };
  const ovr = Math.round(values.reduce((sum, entry) => sum + ovrFromValues(entry.values, entry.position), 0) / SQUAD_PLAYERS);
  return {
    ok: true,
    build: normalized,
    power: {
      position: best.position,
      ovr,
      values: best.values,
      squadStrength: { off: strength.off, def: strength.def },
      squadPlayers: values,
    },
    summary: summaryFor(normalized, ovr, false),
  };
}

export function validateBuild(
  build: LobbyBuild,
  settings: LobbySettings,
  data: Catalog,
  team: string,
  secret: string,
  options: BuildOptions = {},
): BuildCheck {
  if (settings.mode === 'normal') return normalBuild(build, settings, data, options.buildSeed);
  if (settings.mode === 'salary') return salaryBuild(build, data, secret, options.salaryGrid);
  return squadBuild(build, settings, data, team, options.buildSeed);
}

function autoNormal(position: Position, era: Era, data: Catalog, seed: string): BuildCheck {
  const pool = poolFor(data, position, era);
  const keys = attrsFor(position);
  const picks: Record<string, Pick> = {};
  const spins: SpinRecord[] = [];
  const filled = new Set<string>();
  for (let index = 0; index < keys.length; index++) {
    const target = spinTarget(pool, seed, index, false, 0, `${seed}:r`);
    if (!target) return { ok: false, error: 'The server could not auto-fill this build.' };
    const open = keys.filter((attr) => !filled.has(attr) && target.player.attrs[attr] !== undefined);
    const attr = open[0];
    if (!attr) return { ok: false, error: 'The server could not auto-fill this build.' };
    filled.add(attr);
    picks[attr] = {
      attr,
      val: target.player.attrs[attr] ?? 0,
      playerName: target.player.name,
      playerShort: target.player.short,
      team: target.player.team,
    };
    spins.push({ attr, team: target.team, playerName: target.player.name, teamRespin: false, playerRespin: false });
  }
  const values = valuesFromPicks(picks);
  const ovr = ovrFromValues(values, position);
  const build: NormalBuild = { kind: 'normal', position, era, picks, spins };
  return {
    ok: true,
    build,
    power: { position, ovr, values },
    summary: summaryFor(build, ovr, true),
  };
}

function autoSquad(settings: LobbySettings, data: Catalog, team: string, buildSeed: string): BuildCheck {
  const players: SquadPlayerBuild[] = [];
  for (const slot of SQUAD_SLOTS) {
    const check = autoNormal(slot.pos, settings.era, data, `${buildSeed}:${slot.id}`);
    if (!check.ok) return check;
    const build = check.build as NormalBuild;
    players.push({ slot: slot.id, position: slot.pos, picks: build.picks, spins: build.spins });
  }
  const check = squadBuild({ kind: 'squad', players }, settings, data, team, buildSeed);
  if (!check.ok) return check;
  return { ...check, summary: { ...check.summary, auto: true } };
}

function autoSalary(data: Catalog, secret: string): BuildCheck {
  const board = salaryBoardFor(secret, data);
  const cards = board.grid.map((column) => [...column].sort((a, b) => a.price - b.price)[0]).filter((card): card is SalCard => Boolean(card));
  if (cards.length !== SAL_COLUMNS.length) return { ok: false, error: 'The server could not auto-fill this build.' };
  const build: SalaryBuild = {
    kind: 'salary',
    position: cards[cards.length - 1]?.posGroup ?? 'guard',
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
  const check = salaryBuild(build, data, secret, board.grid);
  if (!check.ok) return check;
  return { ...check, summary: { ...check.summary, auto: true } };
}

export function autoBuild(
  settings: LobbySettings,
  data: Catalog,
  team: string,
  buildSeed: string,
  secret: string,
): BuildCheck {
  if (settings.mode === 'normal') return autoNormal('guard', settings.era, data, buildSeed);
  if (settings.mode === 'salary') return autoSalary(data, secret);
  return autoSquad(settings, data, team, buildSeed);
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
