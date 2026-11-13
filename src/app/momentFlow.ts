import type { Catalog } from '../shared/data/loader';
import { renderMomentText, type MomentBank, type MomentTemplate } from '../shared/data/moments';
import { ovrFromValues } from '../shared/engine/ovr';
import { seededRng } from '../shared/engine/rng';
import type { SeasonDraft } from '../shared/engine/season';
import type { MomentCard, Player, Position } from '../shared/engine/types';

const OFF_KEYS = ['jumpShot', 'finishing', 'handles', 'playmaking', 'clutch'];
const DEF_KEYS = ['perimeterDefense', 'interiorDefense'];

export interface DealTarget {
  name: string;
  team: string;
  ovr: number;
}

function scoreOf(player: Player, keys: readonly string[]): number {
  return keys.reduce((sum, key) => sum + (player.attrs[key] ?? 0), 0);
}

function ovrOf(player: Player, group: Position): number {
  return ovrFromValues(player.attrs, group);
}

function poolByTeam(catalog: Catalog): Array<{ player: Player; group: Position }> {
  const seen = new Set<string>();
  const out: Array<{ player: Player; group: Position }> = [];
  const add = (players: Player[], group: Position) => {
    for (const player of players) {
      if (seen.has(player.name)) continue;
      seen.add(player.name);
      out.push({ player, group });
    }
  };
  add(catalog.currentGuards, 'guard');
  add(catalog.currentBigs, 'big');
  return out;
}

function dealTarget(
  rng: () => number,
  list: DealTarget[],
  mine: string,
  options: { lo?: number; not?: string } = {},
): DealTarget | null {
  const lo = options.lo ?? 80;
  const pool = list.filter((entry) => entry.team !== mine && entry.name !== options.not);
  const stars = pool.filter((entry) => entry.ovr >= 90);
  const good = pool.filter((entry) => entry.ovr >= lo && entry.ovr < 90);
  const from = rng() < 0.05 && stars.length ? stars : good;
  return from[Math.floor(rng() * from.length)] ?? null;
}

function dealContext(catalog: Catalog, team: string, rng: () => number): { star: DealTarget | null; stop: DealTarget | null } {
  const pool = poolByTeam(catalog);
  const scorers = pool
    .map((entry) => ({ entry, score: scoreOf(entry.player, OFF_KEYS) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 80)
    .map(({ entry }) => ({ name: entry.player.name, team: entry.player.team, ovr: ovrOf(entry.player, entry.group) }));
  const stoppers = pool
    .map((entry) => ({ entry, score: scoreOf(entry.player, DEF_KEYS) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 60)
    .map(({ entry }) => ({ name: entry.player.name, team: entry.player.team, ovr: ovrOf(entry.player, entry.group) }));
  const star = dealTarget(rng, scorers, team);
  const stop = dealTarget(rng, stoppers, team, { lo: 76, not: star?.name });
  return { star, stop };
}

function phaseForStop(stop: number, total = 82): string {
  if (stop >= total) return 'playoffs';
  const share = stop / total;
  return share < 0.3 ? 'early' : share < 0.55 ? 'mid' : share < 0.8 ? 'late' : 'stretch';
}

function teamNick(catalog: Catalog, team: string): string {
  const found = catalog.teams.find((entry) => entry.short === team);
  return found?.name ?? team;
}

function requirementMet(
  template: MomentTemplate,
  state: { wins: number; losses: number; left: number },
): boolean {
  if (state.left < template.minLeft) return false;
  const pace = state.wins + state.losses ? (state.wins / (state.wins + state.losses)) * 82 : 41;
  if (template.requires === 'clinched') return state.wins >= 42 || pace >= 42;
  if (template.requires === 'eliminated') return state.wins + state.left < 42 && pace < 42;
  return true;
}

export function pickMoment(options: {
  bank: MomentBank;
  catalog: Catalog;
  draft: SeasonDraft;
  seed: string;
  stop: number;
  recent: string[];
  playerName: string;
}): MomentCard | null {
  const { bank, catalog, draft, seed, stop, recent, playerName } = options;
  const phase = phaseForStop(stop);
  const wins = draft.games.filter((game) => game.won).length;
  const state = { wins, losses: draft.games.length - wins, left: 82 - draft.games.length };
  const rng = seededRng(`${seed}:moment:${stop}`);
  const used = new Set(draft.decisions.map((decision) => decision.momentId));
  const fits = bank.templates.filter(
    (template) =>
      template.at.includes(phase) &&
      !used.has(template.id) &&
      requirementMet(template, state) &&
      template.options.every((option) => !option.effect.deals || phase !== 'playoffs'),
  );
  if (!fits.length) return null;
  const weightOf = (template: MomentTemplate) => {
    const seen = recent.indexOf(template.id);
    const penalty = seen === -1 ? 1 : 0.25 + 0.75 * (seen / 30);
    return template.weight * penalty;
  };
  const total = fits.reduce((sum, template) => sum + weightOf(template), 0);
  let roll = rng() * total;
  let chosen = fits[fits.length - 1] as MomentTemplate;
  for (const template of fits) {
    roll -= weightOf(template);
    if (roll <= 0) {
      chosen = template;
      break;
    }
  }
  const deals = chosen.options.some((option) => option.effect.deals);
  const targets = deals ? dealContext(catalog, draft.team, rng) : { star: null, stop: null };
  const ctx: Record<string, string | number> = {
    name: playerName,
    'c.name': playerName,
    nick: teamNick(catalog, draft.team),
    'c.nick': teamNick(catalog, draft.team),
    left: 82 - draft.games.length,
    'c.left': 82 - draft.games.length,
    'star.name': targets.star?.name ?? '',
    'star.team': targets.star?.team ?? '',
    'stop.name': targets.stop?.name ?? '',
    'stop.team': targets.stop?.team ?? '',
  };
  return {
    id: chosen.id,
    kicker: renderMomentText(chosen.kicker, ctx),
    title: renderMomentText(chosen.title, ctx),
    body: renderMomentText(chosen.body, ctx),
    stop,
    options: chosen.options.map((option) => ({
      id: option.id,
      label: renderMomentText(option.label, ctx),
      flavor: renderMomentText(option.flavor, ctx),
      effect: option.effect,
    })),
  };
}
