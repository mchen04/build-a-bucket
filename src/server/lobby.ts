import * as v from 'valibot';
import { loadCatalog, poolFor, type Catalog } from '../shared/data/loader';
import { ATTR_LABELS, BIG_ATTRS, CURRENT_TEAMS, GUARD_ATTRS, gradeFor } from '../shared/engine/rules';
import { seededRng } from '../shared/engine/rng';
import { simulateSeason } from '../shared/engine/season';
import type { Build, PlayoffRound, SeasonResult, SeriesRound } from '../shared/engine/types';
import { cleanName, generateCode, hashSecret } from '../shared/mp/codes';
import { BuildDraftSchema, SettingsSchema } from '../shared/mp/schemas';
import {
  AWAY_MS,
  BARRIER_HOLD_SECONDS,
  CAPACITY,
  DEFAULT_REVEAL_SECONDS,
  HOST_IDLE_MS,
  MAX_ROUNDS,
  finishRankOf,
  type ApiErrorBody,
  type BuildDraft,
  type EventView,
  type LobbyPhase,
  type LobbySettings,
  type LobbyView,
  type ParticipantStatus,
  type ParticipantView,
  type RoundView,
  type SeasonSummary,
  type StandingEntry,
} from '../shared/mp/types';
import { SeasonSchema } from '../shared/data/schemas';
import { db, errorMessage, isUniqueViolation } from './db';

export type Outcome = { ok: true; view: LobbyView } | { ok: false; status: number; error: ApiErrorBody };

export type LeaveOutcome =
  | { ok: true; view: LobbyView | null }
  | { ok: false; status: number; error: ApiErrorBody };

const CREATE_DEFAULT_SETTINGS: LobbySettings = {
  era: 'current',
  positions: ['guard', 'big'],
  revealSeconds: DEFAULT_REVEAL_SECONDS,
};

const TEAM_SHORTS = new Set(Object.keys(CURRENT_TEAMS));
const ATTRS_PER_BUILD = 10;

interface RawLobby {
  id: string;
  code: string;
  phase: LobbyPhase;
  host_participant: string | null;
  settings: unknown;
  version: number | string;
  playoffs_started_at: string | null;
}

interface RawParticipant {
  id: string;
  name: string;
  seat: number;
  status: ParticipantStatus;
  joined_at: string;
  last_seen: string;
  is_me: boolean;
  build: unknown;
  summary: { filled: number; latest: string | null } | null;
  season: unknown;
}

interface RawEvent {
  id: number | string;
  kind: string;
  payload: Record<string, unknown>;
  participant_id: string | null;
  at: string;
}

interface ReadRow {
  lobby: RawLobby | null;
  participants: RawParticipant[];
  events: RawEvent[];
}

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

function parseSettings(raw: unknown): LobbySettings {
  const parsed = v.safeParse(SettingsSchema, raw);
  return parsed.success ? parsed.output : CREATE_DEFAULT_SETTINGS;
}

function parseSeason(raw: unknown): SeasonResult | null {
  if (!raw) return null;
  const parsed = v.safeParse(SeasonSchema, raw);
  return parsed.success ? (parsed.output as unknown as SeasonResult) : null;
}

function parseDraft(raw: unknown): BuildDraft | null {
  if (!raw) return null;
  const parsed = v.safeParse(BuildDraftSchema, raw);
  return parsed.success ? (parsed.output as unknown as BuildDraft) : null;
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

function pickDetail(draft: BuildDraft): string | null {
  const latest = draft.latest ?? null;
  if (!latest) return null;
  const pick = draft.picks[latest.attr];
  const label = ATTR_LABELS[latest.attr];
  if (!pick || !label) return null;
  return `took ${pick.playerName}'s ${label.short} ${gradeFor(pick.val)}`;
}

function toRoundView(round: PlayoffRound): RoundView {
  if (round.type === 'playin') {
    return {
      name: 'Play-In',
      opponent: round.opponent.short,
      won: round.advanced,
      wins: round.games.filter((game) => game === 'W').length,
      losses: round.games.filter((game) => game === 'L').length,
      label: round.label,
    };
  }
  return {
    name: round.name,
    opponent: round.opponent.short,
    won: round.won,
    wins: round.wins,
    losses: round.losses,
    label: null,
  };
}

function finishLabelFor(season: SeasonResult, series: SeriesRound[], playedPlayIn: boolean): string {
  if (season.champion) return 'Champion';
  if (!season.madePlayoffs) return playedPlayIn ? 'Play-in exit' : 'Missed playoffs';
  const last = series[series.length - 1];
  if (!last) return 'Playoffs';
  if (last.name === 'NBA Finals') return 'Finals loss';
  if (last.name === 'Conference Finals') return 'Conference finals';
  if (last.name === 'Conference Semifinals') return 'Semis';
  return 'First round';
}

export function revealSeasonSummary(season: SeasonResult, revealed: number, finalPhase: boolean): SeasonSummary {
  const rounds = rawRounds(season);
  const series = rounds.filter((round): round is SeriesRound => round.type === 'series');
  const playedPlayIn = rounds.some((round) => round.type === 'playin');
  const revealedAll = finalPhase || (rounds.length > 0 && revealed >= rounds.length);
  const finishRank = finishRankOf({
    champion: season.champion,
    madePlayoffs: season.madePlayoffs,
    seriesRounds: series.length,
    playedPlayIn,
  });
  return {
    wins: season.wins,
    losses: season.losses,
    ovr: season.ovr,
    seed: season.seed,
    ppg: season.ppg,
    rpg: season.rpg,
    apg: season.apg,
    madePlayoffs: season.madePlayoffs,
    champion: revealedAll ? season.champion : false,
    archetype: season.archetype ?? '',
    team: season.team,
    qualified: season.madePlayoffs,
    finishRank,
    finishLabel: revealedAll ? finishLabelFor(season, series, playedPlayIn) : null,
  };
}

function rawRounds(season: SeasonResult | null): PlayoffRound[] {
  if (!season || !season.madePlayoffs) return [];
  return season.playoffRounds.slice(0, MAX_ROUNDS);
}

function buildView(row: ReadRow, now: number): LobbyView | null {
  const raw = row.lobby;
  if (!raw) return null;
  const meRow = row.participants.find((entry) => entry.is_me);
  if (!meRow) return null;
  const settings = parseSettings(raw.settings);
  const startedAt = raw.playoffs_started_at ? Date.parse(raw.playoffs_started_at) : null;
  const revealed =
    startedAt === null
      ? 0
      : Math.max(0, Math.min(MAX_ROUNDS, 1 + Math.floor((now - startedAt) / (settings.revealSeconds * 1000))));
  const byId = new Map(row.participants.map((entry) => [entry.id, entry]));
  const roundsTotal = row.participants.reduce((max, entry) => Math.max(max, rawRounds(parseSeason(entry.season)).length), 0);
  const hostId = raw.host_participant;
  const participants: ParticipantView[] = row.participants.map((entry) => {
    const season = parseSeason(entry.season);
    const rounds = rawRounds(season).slice(0, revealed).map(toRoundView);
    return {
      seat: entry.seat,
      name: entry.name,
      isHost: hostId !== null && hostId === entry.id,
      isMe: entry.is_me,
      away: now - Date.parse(entry.last_seen) > AWAY_MS,
      status: entry.status,
      joinedAt: entry.joined_at,
      lastSeen: entry.last_seen,
      build: entry.is_me ? parseDraft(entry.build) : null,
      summary: entry.summary
        ? { filled: entry.summary.filled, total: ATTRS_PER_BUILD, latest: entry.summary.latest }
        : null,
      season: season ? revealSeasonSummary(season, revealed, raw.phase === 'finished') : null,
      rounds,
      roundsTotal,
    };
  });
  const me = participants.find((entry) => entry.isMe);
  if (!me) return null;
  const events: EventView[] = row.events.map((event) => {
    const owner = event.participant_id ? byId.get(event.participant_id) : undefined;
    const seat = typeof event.payload.seat === 'number' ? event.payload.seat : owner?.seat ?? null;
    const name = typeof event.payload.name === 'string' ? event.payload.name : owner?.name ?? null;
    return {
      id: Number(event.id),
      kind: event.kind,
      seat,
      name,
      detail: typeof event.payload.detail === 'string' ? event.payload.detail : null,
      at: event.at,
    };
  });
  const standings: StandingEntry[] | null =
    raw.phase === 'finished'
      ? participants
          .filter((entry) => entry.season !== null)
          .map((entry) => {
            const season = entry.season as SeasonSummary;
            return {
              seat: entry.seat,
              name: entry.name,
              isMe: entry.isMe,
              record: `${season.wins}-${season.losses}`,
              ovr: season.ovr,
              finishLabel: season.finishLabel,
              rank: season.finishRank,
            };
          })
          .sort((a, b) => a.rank - b.rank || b.ovr - a.ovr || a.seat - b.seat)
          .map(({ rank: _rank, ...entry }) => entry)
      : null;
  return {
    code: raw.code,
    phase: raw.phase,
    version: Number(raw.version),
    settings,
    capacity: CAPACITY,
    seatsTaken: row.participants.filter((entry) => entry.status !== 'left').length,
    hostSeat: participants.find((entry) => entry.isHost)?.seat ?? null,
    playoffsStartedAt: raw.playoffs_started_at,
    revealSeconds: settings.revealSeconds,
    roundsRevealed: revealed,
    roundsTotal,
    participants,
    me,
    events,
    standings,
    serverTime: new Date(now).toISOString(),
  };
}

const READ_SQL = `
with l as (select * from lobbies where code = $1),
hb as (
  update participants p set last_seen = now()
  where p.lobby_id = (select id from l) and p.token_hash = $2
    and p.last_seen < now() - interval '10 seconds'
  returning p.id
)
select
  (select json_build_object(
    'id', l.id, 'code', l.code, 'phase', l.phase, 'host_participant', l.host_participant,
    'settings', l.settings, 'version', l.version, 'playoffs_started_at', l.playoffs_started_at
  ) from l) as lobby,
  (select coalesce(json_agg(json_build_object(
    'id', p.id, 'name', p.name, 'seat', p.seat, 'status', p.status,
    'joined_at', p.joined_at, 'last_seen', p.last_seen,
    'is_me', p.token_hash = $2,
    'build', case when p.token_hash = $2 then p.build else null end,
    'summary', case when p.build is null then null else json_build_object(
      'filled', (select count(*) from jsonb_object_keys(coalesce(p.build->'picks', '{}'::jsonb))),
      'latest', p.build->'latest'->>'playerName'
    ) end,
    'season', case when p.season is null then null else json_build_object(
      'wins', p.season->'wins', 'losses', p.season->'losses', 'ovr', p.season->'ovr', 'seed', p.season->'seed',
      'ppg', p.season->'ppg', 'rpg', p.season->'rpg', 'apg', p.season->'apg',
      'madePlayoffs', p.season->'madePlayoffs', 'champion', p.season->'champion',
      'archetype', p.season->'archetype', 'team', p.season->'team',
      'position', p.season->'position',
      'spg', p.season->'spg', 'bpg', p.season->'bpg', 'tov', p.season->'tov',
      'fgPct', p.season->'fgPct', 'threePct', p.season->'threePct', 'ftPct', p.season->'ftPct',
      'per', p.season->'per', 'games', coalesce(p.season->'games', '[]'::jsonb),
      'gameLog', coalesce(p.season->'gameLog', '[]'::jsonb),
      'bestGame', p.season->'bestGame',
      'conference', p.season->'conference', 'standings', coalesce(p.season->'standings', '[]'::jsonb),
      'playoffRounds', coalesce(p.season->'playoffRounds', '[]'::jsonb),
      'mvp', p.season->'mvp', 'dpoy', p.season->'dpoy',
      'finalsOpp', p.season->'finalsOpp', 'finalsSeries', p.season->'finalsSeries',
      'displayMvp', p.season->'displayMvp', 'displayDpoy', p.season->'displayDpoy',
      'goatRank', p.season->'goatRank'
    ) end
  ) order by p.seat), '[]'::json) from participants p where p.lobby_id = (select id from l)) as participants,
  (select coalesce(json_agg(json_build_object(
    'id', e.id, 'kind', e.kind, 'payload', e.payload, 'participant_id', e.participant_id, 'at', e.created_at
  ) order by e.id desc), '[]'::json) from (select * from events where lobby_id = (select id from l) order by id desc limit 30) e) as events
`;

const HOST_SQL = `
with candidate as (
  select p.id from participants p join lobbies l on l.id = p.lobby_id
  where l.code = $1 and p.status <> 'left' and p.last_seen > now() - make_interval(secs => $2::int)
  order by p.joined_at asc, p.seat asc limit 1
), stale as (
  select l.id from lobbies l
  where l.code = $1 and (
    l.host_participant is null
    or not exists (
      select 1 from participants h
      where h.id = l.host_participant and h.status <> 'left'
        and h.last_seen > now() - make_interval(secs => $2::int)
    )
  )
), moved as (
  update lobbies l set host_participant = (select id from candidate), version = l.version + 1, updated_at = now()
  where l.id = (select id from stale)
    and (select id from candidate) is not null
    and (select id from candidate) is distinct from l.host_participant
  returning l.id, l.host_participant
)
insert into events (lobby_id, participant_id, kind, payload)
select m.id, m.host_participant, 'host_changed',
  jsonb_build_object('name', (select p.name from participants p where p.id = m.host_participant), 'detail', 'is the new host')
from moved m
`;

const BARRIER_SQL = `
with waiting as (
  select l.id as lobby_id,
    (select p.id from participants p
      where p.lobby_id = l.id and p.status <> 'left' and p.last_seen > now() - make_interval(secs => $2::int)
      order by p.joined_at asc, p.seat asc limit 1) as participant_id,
    (select p.name from participants p
      where p.lobby_id = l.id and p.status <> 'left' and p.last_seen > now() - make_interval(secs => $2::int)
      order by p.joined_at asc, p.seat asc limit 1) as name
  from lobbies l
  where l.code = $1 and l.phase in ('building', 'season')
    and not exists (
      select 1 from participants p
      where p.lobby_id = l.id and p.status <> 'left'
        and p.last_seen > now() - make_interval(secs => $2::int)
        and p.status not in ('qualified', 'eliminated', 'done')
    )
), moved as (
  update lobbies l set phase = 'barrier', version = l.version + 1, updated_at = now()
  from waiting w
  where l.id = w.lobby_id
  returning l.id
)
insert into events (lobby_id, participant_id, kind, payload)
select w.lobby_id, w.participant_id, 'barrier',
  jsonb_build_object('name', w.name, 'detail', 'is waiting at the playoff barrier')
from waiting w
`;

const FINISH_SQL = `
with done as (
  update participants p set status = 'done'
  from lobbies l
  where l.code = $1 and l.phase = 'playoffs' and l.playoffs_started_at is not null
    and l.playoffs_started_at + make_interval(secs => coalesce((l.settings->>'revealSeconds')::int, 5) * $2::int) < now()
    and p.lobby_id = l.id and p.status = 'playoffs'
  returning p.id
)
update lobbies l set phase = 'finished', version = l.version + 1, updated_at = now()
where l.code = $1 and l.phase = 'playoffs' and l.playoffs_started_at is not null
  and l.playoffs_started_at + make_interval(secs => coalesce((l.settings->>'revealSeconds')::int, 5) * $2::int) < now()
`;

async function maintain(code: string): Promise<void> {
  const sql = db();
  await sql.query(HOST_SQL, [code, Math.floor(HOST_IDLE_MS / 1000)]);
  await sql.query(BARRIER_SQL, [code, Math.floor(AWAY_MS / 1000)]);
  await sql.query(FINISH_SQL, [code, MAX_ROUNDS - 1]);
}

function needsMaintenance(row: ReadRow, now: number): boolean {
  const lobby = row.lobby;
  if (!lobby) return false;
  const host = row.participants.find((entry) => entry.id === lobby.host_participant);
  if (!host || host.status === 'left' || now - Date.parse(host.last_seen) > HOST_IDLE_MS) return true;
  if (lobby.phase === 'lobby') return false;
  const anyResult = row.participants.some(
    (entry) => entry.status === 'qualified' || entry.status === 'eliminated' || entry.status === 'done',
  );
  if ((lobby.phase === 'building' || lobby.phase === 'season') && anyResult) return true;
  if (lobby.phase === 'barrier') return true;
  if (lobby.phase === 'playoffs' && lobby.playoffs_started_at) {
    const revealSeconds = parseSettings(lobby.settings).revealSeconds;
    return Date.parse(lobby.playoffs_started_at) + revealSeconds * (MAX_ROUNDS - 1) * 1000 <= now;
  }
  return false;
}

export async function readLobby(input: { code: string; secret: string }): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  try {
    const rows = await sql.query<ReadRow>(READ_SQL, [input.code, tokenHash]);
    const row = rows[0];
    if (!row?.lobby) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!needsMaintenance(row, Date.now())) {
      const view = buildView(row, Date.now());
      if (!view) {
        return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
      }
      return { ok: true, view };
    }
    await maintain(input.code);
    const refreshed = (await sql.query<ReadRow>(READ_SQL, [input.code, tokenHash]))[0];
    if (!refreshed?.lobby) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    const view = buildView(refreshed, Date.now());
    if (!view) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    return { ok: true, view };
  } catch (error) {
    return { ok: false, status: 503, error: { error: errorMessage(error), reason: 'server' } };
  }
}

const CREATE_LOBBY_SQL = `
insert into lobbies (code, phase, settings, version, create_action)
values ($1, 'lobby', $2::jsonb, 1, $3::uuid)
on conflict (create_action) do nothing
returning id, code
`;

const FIND_LOBBY_SQL = 'select id, code from lobbies where create_action = $1::uuid';

const CREATE_PARTICIPANT_SQL = `
insert into participants (lobby_id, token_hash, name, seat, status)
values ($1::uuid, $2, $3, 1, 'joined')
on conflict (lobby_id, token_hash) do update set name = excluded.name, last_seen = now()
returning id, seat
`;

const CLAIM_HOST_SQL = `
with l as (select id, host_participant from lobbies where id = $1::uuid),
claim as (
  update lobbies set host_participant = $2::uuid, updated_at = now()
  where id = (select id from l) and host_participant is null
  returning id
)
insert into events (lobby_id, participant_id, kind, payload)
select id, $2::uuid, 'joined',
  jsonb_build_object('seat', (select seat from participants where id = $2::uuid), 'name', $3::text, 'detail', 'created the lobby')
from claim
`;

export interface CreateResult {
  ok: true;
  code: string;
  seat: number;
  participantId: string;
  view: LobbyView;
}

export async function createLobby(input: {
  name: string;
  secret: string;
  actionId: string;
  settings: LobbySettings;
}): Promise<CreateResult | Extract<Outcome, { ok: false }>> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  const name = cleanName(input.name) || 'Player';
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const code = generateCode();
      const created = await sql.query<{ id: string; code: string }>(CREATE_LOBBY_SQL, [
        code,
        JSON.stringify(input.settings),
        input.actionId,
      ]);
      const row = created[0] ?? (await sql.query<{ id: string; code: string }>(FIND_LOBBY_SQL, [input.actionId]))[0];
      if (!row) throw new Error('lobby insert returned no row');
      const participant = await sql.query<{ id: string; seat: number }>(CREATE_PARTICIPANT_SQL, [
        row.id,
        tokenHash,
        name,
      ]);
      const seatRow = participant[0];
      if (!seatRow) throw new Error('participant insert returned no row');
      await sql.query(CLAIM_HOST_SQL, [row.id, seatRow.id, name]);
      const outcome = await readLobby({ code: row.code, secret: input.secret });
      if (!outcome.ok) return outcome;
      return { ok: true, code: row.code, seat: seatRow.seat, participantId: seatRow.id, view: outcome.view };
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      return { ok: false, status: 503, error: { error: errorMessage(error), reason: 'server' } };
    }
  }
  return { ok: false, status: 503, error: { error: 'Could not allocate a lobby code.', reason: 'server' } };
}

const JOIN_SQL = `
with l as (select id, phase from lobbies where code = $1),
mine as (select p.seat from participants p where p.lobby_id = (select id from l) and p.token_hash = $2),
free_seat as (
  select s as seat from generate_series(1, $4::int) s
  where not exists (select 1 from participants p where p.lobby_id = (select id from l) and p.seat = s)
  order by s limit 1
),
target as (select coalesce((select seat from mine), (select seat from free_seat)) as seat),
seated as (
  insert into participants (lobby_id, token_hash, name, seat, status)
  select l.id, $2, $3, t.seat, 'joined'
  from l, target t
  where t.seat is not null and (l.phase = 'lobby' or (select seat from mine) is not null)
  on conflict (lobby_id, token_hash) do update
    set name = excluded.name, last_seen = now(),
        status = case when participants.status = 'left' then 'joined' else participants.status end
  returning id, seat
),
log as (
  insert into events (lobby_id, participant_id, kind, payload)
  select l.id, s.id, 'joined', jsonb_build_object('seat', s.seat, 'name', $3::text, 'detail', 'joined the lobby')
  from l, seated s
  where (select seat from mine) is null
),
bump as (
  update lobbies lob set version = lob.version + 1, updated_at = now()
  from seated s
  where lob.id = (select id from l)
  returning lob.version
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select seat from mine) as existing_seat,
  (select seat from free_seat) as free_seat,
  (select seat from target) as seat,
  (select id from seated) as participant_id
`;

export async function joinLobby(input: {
  code: string;
  name: string;
  secret: string;
  actionId: string;
}): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  const name = cleanName(input.name) || 'Player';
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const rows = await sql.query<{
        lobby_id: string | null;
        phase: LobbyPhase | null;
        existing_seat: number | null;
        free_seat: number | null;
        seat: number | null;
        participant_id: string | null;
      }>(JOIN_SQL, [input.code, tokenHash, name, CAPACITY]);
      const row = rows[0];
      if (!row?.lobby_id) {
        return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
      }
      if (row.participant_id === null && row.existing_seat === null) {
        if (row.phase !== 'lobby') {
          return { ok: false, status: 409, error: { error: 'That lobby already started.', reason: 'started' } };
        }
        return { ok: false, status: 409, error: { error: `Lobby is full (${CAPACITY}/${CAPACITY}).`, reason: 'full' } };
      }
      return readLobby({ code: input.code, secret: input.secret });
    } catch (error) {
      if (isUniqueViolation(error)) {
        await new Promise((resolve) => setTimeout(resolve, 10 + attempt * 10));
        continue;
      }
      return { ok: false, status: 503, error: { error: errorMessage(error), reason: 'server' } };
    }
  }
  return { ok: false, status: 503, error: { error: 'Could not take a seat.', reason: 'server' } };
}

const START_SQL = `
with l as (select id, phase, host_participant, version from lobbies where code = $1),
me as (select p.id, p.seat from participants p where p.lobby_id = (select id from l) and p.token_hash = $2),
act as (
  insert into actions (participant_id, action_id, lobby_id)
  select me.id, $3::uuid, (select id from l) from me
  on conflict (participant_id, action_id) do nothing
  returning participant_id
),
started as (
  update lobbies lob set phase = 'building', settings = $4::jsonb, version = lob.version + 1, updated_at = now()
  from l, me
  where lob.id = l.id and lob.phase = 'lobby' and lob.host_participant = me.id and exists (select 1 from act)
  returning lob.version
),
log as (
  insert into events (lobby_id, participant_id, kind, payload)
  select (select id from l), (select id from me), 'started',
    jsonb_build_object('seat', (select seat from me), 'name', (select name from participants where id = (select id from me)), 'detail', $5::text)
  from started
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select host_participant from l) as host,
  (select id from me) as me_id,
  (select count(*)::int from started) as started,
  exists (select 1 from act) as action_ok
`;

export async function startLobby(input: {
  code: string;
  secret: string;
  actionId: string;
  settings: LobbySettings;
}): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  const detail = 'started the season';
  try {
    const rows = await sql.query<{
      lobby_id: string | null;
      phase: LobbyPhase | null;
      host: string | null;
      me_id: string | null;
      started: number;
      action_ok: boolean;
    }>(START_SQL, [input.code, tokenHash, input.actionId, JSON.stringify(input.settings), detail]);
    const row = rows[0];
    if (!row?.lobby_id) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!row.me_id) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    if (row.started === 0 && row.action_ok && row.phase !== 'lobby' && row.phase !== 'building') {
      return { ok: false, status: 409, error: { error: 'This lobby already started.', reason: 'started' } };
    }
    if (row.started === 0 && row.action_ok && row.host !== row.me_id) {
      return { ok: false, status: 403, error: { error: 'Only the host can start the season.', reason: 'forbidden' } };
    }
    return readLobby({ code: input.code, secret: input.secret });
  } catch (error) {
    return { ok: false, status: 503, error: { error: errorMessage(error), reason: 'server' } };
  }
}

const WRITE_BUILD_SQL = `
with l as (select id, phase from lobbies where code = $1),
me as (
  select p.id, p.seat, p.name from participants p
  where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'
),
act as (
  insert into actions (participant_id, action_id, lobby_id)
  select me.id, $3::uuid, (select id from l) from me
  on conflict (participant_id, action_id) do nothing
  returning participant_id
),
written as (
  update participants p
  set build = $4::jsonb,
      season = coalesce($5::jsonb, p.season),
      status = $6::text,
      last_seen = now()
  from me, act, l
  where p.id = me.id and act.participant_id = me.id
    and l.phase in ('building', 'season', 'barrier', 'playoffs')
    and (
      $6::text <> 'building'
      or (p.season is null and p.status not in ('qualified', 'eliminated', 'playoffs', 'done'))
    )
  returning p.id, p.seat, p.name
),
bump as (
  update lobbies lob set version = lob.version + 1, updated_at = now()
  from written where lob.id = (select id from l)
  returning lob.version
),
log as (
  insert into events (lobby_id, participant_id, kind, payload)
  select (select id from l), w.id, $7::text,
    jsonb_build_object('seat', w.seat, 'name', w.name, 'detail', $8::text)
  from written w
  where $8::text is not null
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select id from me) as me_id,
  (select count(*)::int from written) as written,
  exists (select 1 from act) as action_ok
`;

async function writeBuild(input: {
  code: string;
  secret: string;
  actionId: string;
  draft: BuildDraft;
  status: ParticipantStatus;
  season: SeasonResult | null;
}): Promise<{ ok: true } | Extract<Outcome, { ok: false }>> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  const detail =
    input.season && input.status !== 'building'
      ? `finished ${input.season.wins}-${input.season.losses}, #${input.season.seed} seed`
      : pickDetail(input.draft);
  const lobbyId = await sql.query<{ id: string }>('select id from lobbies where code = $1', [input.code]);
  const id = lobbyId[0]?.id;
  if (!id) return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
  const rows = await sql.query<{
    lobby_id: string | null;
    phase: LobbyPhase | null;
    me_id: string | null;
    written: number;
    action_ok: boolean;
  }>(WRITE_BUILD_SQL, [
    input.code,
    tokenHash,
    input.actionId,
    JSON.stringify(input.draft),
    input.season ? JSON.stringify(input.season) : null,
    input.status,
    input.status === 'building' ? 'pick' : input.status,
    detail,
  ]);
  const row = rows[0];
  if (!row?.lobby_id) {
    return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
  }
  if (!row.me_id) {
    return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
  }
  if (row.written === 0 && row.action_ok && row.phase === 'lobby') {
    return { ok: false, status: 409, error: { error: 'The host has not started this lobby yet.', reason: 'conflict' } };
  }
  if (row.written === 0 && row.action_ok && row.phase === 'finished') {
    return { ok: false, status: 409, error: { error: 'This lobby is already finished.', reason: 'conflict' } };
  }
  if (row.written > 0 && input.status !== 'building') {
    await sql.query(
      "update lobbies set phase = 'season', version = version + 1, updated_at = now() where id = $1::uuid and phase = 'building'",
      [id],
    );
  }
  return { ok: true };
}

export async function syncDraft(input: {
  code: string;
  secret: string;
  actionId: string;
  draft: BuildDraft;
}): Promise<Outcome> {
  try {
    const written = await writeBuild({ ...input, status: 'building', season: null });
    if (!written.ok) return written;
    await maintain(input.code);
    return readLobby({ code: input.code, secret: input.secret });
  } catch (error) {
    return { ok: false, status: 503, error: { error: errorMessage(error), reason: 'server' } };
  }
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
    await maintain(input.code);
    return readLobby({ code: input.code, secret: input.secret });
  } catch (error) {
    return { ok: false, status: 503, error: { error: errorMessage(error), reason: 'server' } };
  }
}

const LEAVE_SQL = `
with l as (select id, phase from lobbies where code = $1),
me as (select p.id, p.seat, p.name from participants p where p.lobby_id = (select id from l) and p.token_hash = $2),
act as (
  insert into actions (participant_id, action_id, lobby_id)
  select me.id, $3::uuid, (select id from l) from me
  on conflict (participant_id, action_id) do nothing
  returning participant_id
),
removed as (
  delete from participants p
  using me, act, l
  where p.id = me.id and act.participant_id = me.id and l.phase = 'lobby'
  returning p.id, p.seat, p.name
),
marked as (
  update participants p set status = 'left', last_seen = now()
  from me, act, l
  where p.id = me.id and act.participant_id = me.id and l.phase <> 'lobby' and p.status <> 'left'
  returning p.id, p.seat, p.name
),
gone as (select * from removed union all select * from marked),
bump as (
  update lobbies lob set version = lob.version + 1, updated_at = now()
  from gone where lob.id = (select id from l)
  returning lob.version
),
log as (
  insert into events (lobby_id, participant_id, kind, payload)
  select (select id from l), x.id, 'left', jsonb_build_object('seat', x.seat, 'name', x.name, 'detail', 'left the lobby')
  from gone x
)
select
  (select id from l) as lobby_id,
  (select id from me) as me_id,
  (select count(*)::int from gone) as left_count,
  exists (select 1 from act) as action_ok
`;

export async function leaveLobby(input: { code: string; secret: string; actionId: string }): Promise<LeaveOutcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  try {
    const rows = await sql.query<{ lobby_id: string | null; me_id: string | null; left_count: number; action_ok: boolean }>(
      LEAVE_SQL,
      [input.code, tokenHash, input.actionId],
    );
    const row = rows[0];
    if (!row?.lobby_id) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!row.me_id) {
      return { ok: false, status: 404, error: { error: 'You are not in this lobby.', reason: 'not_found' } };
    }
    await maintain(input.code);
    const outcome = await readLobby({ code: input.code, secret: input.secret });
    return outcome.ok ? outcome : { ok: true, view: null };
  } catch (error) {
    return { ok: false, status: 503, error: { error: errorMessage(error), reason: 'server' } };
  }
}

const RELEASE_SQL = `
with l as (select id, phase, host_participant from lobbies where code = $1),
me as (select p.id, p.seat from participants p where p.lobby_id = (select id from l) and p.token_hash = $2),
act as (
  insert into actions (participant_id, action_id, lobby_id)
  select me.id, $3::uuid, (select id from l) from me
  on conflict (participant_id, action_id) do nothing
  returning participant_id
),
pending as (
  select count(*)::int as n from participants p
  where p.lobby_id = (select id from l) and p.status <> 'left'
    and p.last_seen > now() - make_interval(secs => $5::int)
    and p.status not in ('qualified', 'eliminated', 'done')
),
hold as (
  select coalesce(
    (select max(e.created_at) from events e
      where e.lobby_id = (select id from l) and e.kind in ('qualified', 'eliminated'))
      > now() - make_interval(secs => $7::int),
    false
  ) as active
),
released as (
  update lobbies lob
  set phase = 'playoffs', playoffs_started_at = now(), version = lob.version + 1, updated_at = now()
  from l, me, pending, hold
  where lob.id = l.id
    and lob.phase in ('building', 'season', 'barrier')
    and exists (select 1 from act)
    and (pending.n = 0 or ($4::boolean and lob.host_participant = me.id))
    and not (hold.active and not $4::boolean)
  returning lob.id
),
marked as (
  update participants p
  set status = case when p.status = 'qualified' then 'playoffs' else 'done' end,
    playoffs = case when p.season is null then null else jsonb_build_object(
      'qualified', coalesce((p.season->>'madePlayoffs')::boolean, false),
      'champion', coalesce((p.season->>'champion')::boolean, false),
      'rounds', coalesce(jsonb_array_length(p.season->'playoffRounds'), 0)
    ) end
  where p.lobby_id = (select id from l)
    and p.status in ('qualified', 'eliminated', 'built', 'season_done')
    and exists (select 1 from released)
  returning p.id
),
log as (
  insert into events (lobby_id, kind, payload)
  select (select id from l), 'playoffs_started', jsonb_build_object('count', (select count(*)::int from marked), 'detail', $6::text)
  from released
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select id from me) as me_id,
  (select n from pending) as pending,
  (select count(*)::int from released) as released,
  (select count(*)::int from marked) as marked,
  (select active from hold) as holding,
  exists (select 1 from act) as action_ok
`;

export async function releasePlayoffs(input: {
  code: string;
  secret: string;
  actionId: string;
  force: boolean;
}): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  try {
    const rows = await sql.query<{
      lobby_id: string | null;
      phase: LobbyPhase | null;
      me_id: string | null;
      pending: number;
      released: number;
      marked: number;
      holding: boolean;
      action_ok: boolean;
    }>(RELEASE_SQL, [
      input.code,
      tokenHash,
      input.actionId,
      input.force,
      Math.floor(AWAY_MS / 1000),
      'the playoffs have started',
      BARRIER_HOLD_SECONDS,
    ]);
    const row = rows[0];
    if (!row?.lobby_id) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!row.me_id) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    if (row.released === 0 && row.phase === 'lobby') {
      return { ok: false, status: 409, error: { error: 'The season has not started yet.', reason: 'conflict' } };
    }
    if (row.released === 0 && row.pending > 0 && row.action_ok) {
      return {
        ok: false,
        status: input.force ? 403 : 409,
        error: input.force
          ? { error: 'Only the host can start the playoffs early.', reason: 'forbidden' }
          : { error: `Waiting on ${row.pending} player${row.pending === 1 ? '' : 's'}.`, reason: 'conflict' },
      };
    }
    if (row.released === 0 && row.holding) {
      return readLobby({ code: input.code, secret: input.secret });
    }
    return readLobby({ code: input.code, secret: input.secret });
  } catch (error) {
    return { ok: false, status: 503, error: { error: errorMessage(error), reason: 'server' } };
  }
}

export async function lobbyExists(code: string): Promise<boolean> {
  const rows = await db().query<{ id: string }>('select id from lobbies where code = $1', [code]);
  return rows.length > 0;
}
