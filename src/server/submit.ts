import { loadCatalog, poolFor, type Catalog } from '../shared/data/loader.js';
import { BIG_ATTRS, CURRENT_TEAMS, GUARD_ATTRS } from '../shared/engine/rules.js';
import { seededRng } from '../shared/engine/rng.js';
import { simulateSeason } from '../shared/engine/season.js';
import type { Build, SeasonResult } from '../shared/engine/types.js';
import { hashSecret } from '../shared/mp/codes.js';
import type { BuildDraft, LobbyPhase, LobbySettings, ParticipantStatus } from '../shared/mp/types.js';
import { db, errorMessage } from './db.js';
import { parseSettings, readLobby, writeBuild, type Outcome } from './lobby.js';

const TEAM_SHORTS = new Set(Object.keys(CURRENT_TEAMS));

let catalogPromise: Promise<Catalog> | null = null;

function catalog(): Promise<Catalog> {
  if (!catalogPromise) {
    catalogPromise = loadCatalog().catch((error: unknown) => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

export function validateDraft(draft: BuildDraft, settings: LobbySettings, data: Catalog): string | null {
  if (draft.era !== settings.era) {
    return `This lobby plays ${settings.era === 'current' ? 'current' : 'all-time'} players.`;
  }
  if (!settings.positions.includes(draft.position)) {
    return `This lobby is set to ${settings.positions.join(' / ')} builds.`;
  }
  const keys: readonly string[] = draft.position === 'guard' ? GUARD_ATTRS : BIG_ATTRS;
  const pool = poolFor(data, draft.position, draft.era);
  const index = new Map(pool.map((player) => [`${player.name}|${player.team}`, player]));
  for (const attr of keys) {
    const pick = draft.picks[attr];
    if (!pick) return `Missing a pick for ${attr}.`;
    if (pick.attr !== attr) return `The ${attr} pick is inconsistent.`;
    const player = index.get(`${pick.playerName}|${pick.team}`);
    if (!player) return `${pick.playerName} is not in the ${draft.era} ${draft.position} pool.`;
    const value = player.attrs[attr];
    if (value === undefined) return `${pick.playerName} has no ${attr} rating.`;
    if (value !== pick.val) return `The ${attr} pick does not match ${pick.playerName}'s rating.`;
  }
  for (const attr of Object.keys(draft.picks)) {
    if (!keys.includes(attr)) return `${attr} is not a ${draft.position} trait.`;
  }
  if (!draft.team) return 'Pick a team before submitting.';
  if (!TEAM_SHORTS.has(draft.team)) return `Unknown team ${draft.team}.`;
  return null;
}

function runSeason(draft: BuildDraft, playerName: string, seed: string): SeasonResult {
  const build: Build = { position: draft.position, era: draft.era, picks: draft.picks };
  return simulateSeason({
    build,
    team: draft.team as string,
    playerName,
    rng: seededRng(seed),
    displayRng: seededRng(`${seed}:display`),
  });
}

export async function submitBuild(input: {
  code: string;
  secret: string;
  actionId: string;
  draft: BuildDraft;
}): Promise<Outcome> {
  try {
    const data = await catalog();
    const lobbyRows = await db().query<{ settings: unknown; phase: LobbyPhase; name: string | null }>(
      `select l.settings, l.phase, (select p.name from participants p where p.lobby_id = l.id and p.token_hash = $2) as name
       from lobbies l where l.code = $1`,
      [input.code, await hashSecret(input.secret)],
    );
    const lobby = lobbyRows[0];
    if (!lobby) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!lobby.name) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    const problem = validateDraft(input.draft, parseSettings(lobby.settings), data);
    if (problem) return { ok: false, status: 400, error: { error: problem, reason: 'invalid' } };
    const seed = `${input.code}:${input.draft.position}:${input.draft.picks.jumpShot?.playerName ?? 'x'}:${input.actionId}`;
    const season = runSeason(input.draft, lobby.name, seed);
    const status: ParticipantStatus = season.madePlayoffs ? 'qualified' : 'eliminated';
    const written = await writeBuild({ ...input, status, season });
    if (!written.ok) return written;
    return readLobby({ code: input.code, secret: input.secret });
  } catch (error) {
    return { ok: false, status: 503, error: { error: errorMessage(error), reason: 'server' } };
  }
}
