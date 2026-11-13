import * as v from 'valibot';
import { LEAGUE_TEAMS, simulateLeague, type HumanTeamInput, type LeagueResult } from '../shared/engine/league.js';
import { cleanName, generateCode, hashSecret } from '../shared/mp/codes.js';
import { isCheckpoint, revealLeague, stageCursorAt, stageTotal } from '../shared/mp/league.js';
import {
  BuildSummarySchema,
  LobbyBuildSchema,
  SettingsSchema,
} from '../shared/mp/schemas.js';
import {
  AWAY_MS,
  CAPACITY,
  EVENT_LIMIT,
  HOST_IDLE_MS,
  type ApiErrorBody,
  type BuildSummary,
  type EventView,
  type LobbyBuild,
  type LobbyDelta,
  type LobbyPhase,
  type LobbySettings,
  type LobbyView,
  type LeagueMode,
  type ParticipantStatus,
  type ParticipantView,
  type ReadyView,
  type SalaryCardPick,
  type TeamAssignmentView,
} from '../shared/mp/types.js';
import { catalog, powerFromBuild, salaryBoardFor, validateBuild, type SalaryBoard } from './league.js';
import { db, isUniqueViolation, serverError } from './db.js';

export type Outcome = { ok: true; view: LobbyView } | { ok: false; status: number; error: ApiErrorBody };
export type LeaveOutcome = { ok: true; view: LobbyView | null } | { ok: false; status: number; error: ApiErrorBody };

const DEFAULT_SETTINGS: LobbySettings = { era: 'current', mode: 'normal' };
const NEXT_PHASE: Record<number, LobbyPhase> = {
  0: 'season',
  1: 'season',
  2: 'season',
  3: 'season',
  4: 'awards',
  5: 'playin',
  6: 'playoffs',
  7: 'playoffs',
  8: 'playoffs',
  9: 'playoffs',
  10: 'recap',
};

interface RawLobby {
  id: string;
  code: string;
  phase: LobbyPhase;
  host_participant: string | null;
  settings: unknown;
  version: number | string;
  mode: string;
  era: string;
  league: unknown;
  stage: number | string;
  stage_cursor: number | string;
  stage_started_at: string | null;
  locked_at: string | null;
  rematch: number | string;
  season_secret: string;
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
  build_kind: string | null;
  build_summary: unknown;
  ready_stage: number | string;
  preview_ready: boolean;
  team: string | null;
  reroll_used: boolean;
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

interface LobbyContextRow {
  id: string;
  phase: LobbyPhase;
  mode: string;
  era: string;
  season_secret: string;
  host_participant: string | null;
  stage: number | string;
  stage_cursor: number | string;
  stage_started_at: string | null;
}

export function parseSettings(raw: unknown): LobbySettings {
  const parsed = v.safeParse(SettingsSchema, raw);
  return parsed.success ? parsed.output : DEFAULT_SETTINGS;
}

function parseBuild(raw: unknown): LobbyBuild | null {
  if (!raw) return null;
  const parsed = v.safeParse(LobbyBuildSchema, raw);
  return parsed.success ? (parsed.output as LobbyBuild) : null;
}

function parseSummary(raw: unknown): BuildSummary | null {
  if (!raw) return null;
  const parsed = v.safeParse(BuildSummarySchema, raw);
  return parsed.success ? parsed.output : null;
}

function parseLeague(raw: unknown): LeagueResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<LeagueResult>;
  if (!Array.isArray(candidate.games) || !candidate.standings || !Array.isArray(candidate.humans)) return null;
  return candidate as LeagueResult;
}

function toEventViews(row: ReadRow): EventView[] {
  const byId = new Map(row.participants.map((entry) => [entry.id, entry]));
  return row.events.map((event) => {
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
}

function salaryView(board: SalaryBoard | null): { salaryBoard: SalaryCardPick[][] | null; salaryBudget: number | null } {
  if (!board) return { salaryBoard: null, salaryBudget: null };
  return {
    salaryBoard: board.grid.map((column) =>
      column.map((card) => ({
        id: card.id,
        name: card.name,
        team: card.team,
        price: card.price,
        attrs: card.attrs,
        fullAttrs: card.fullAttrs,
        posGroup: card.posGroup,
      })),
    ),
    salaryBudget: board.budget,
  };
}

function buildView(row: ReadRow, now: number, board: SalaryBoard | null): LobbyView | null {
  const raw = row.lobby;
  if (!raw) return null;
  const meRow = row.participants.find((entry) => entry.is_me);
  if (!meRow) return null;
  const settings = parseSettings(raw.settings);
  const league = parseLeague(raw.league);
  const stage = Number(raw.stage);
  const cursor = Number(raw.stage_cursor);
  const leagueView = league ? revealLeague(league, stage, cursor, meRow.id) : null;
  const teams: TeamAssignmentView[] = row.participants
    .filter((entry) => entry.status !== 'left' && entry.team)
    .map((entry) => ({
      seat: entry.seat,
      name: entry.name,
      team: entry.team as string,
      rerollUsed: entry.reroll_used,
      isMe: entry.is_me,
    }))
    .sort((a, b) => a.seat - b.seat);
  const present = row.participants.filter((entry) => entry.status !== 'left' && now - Date.parse(entry.last_seen) <= AWAY_MS);
  const participants: ParticipantView[] = row.participants.map((entry) => {
    const ready =
      raw.phase === 'preview'
        ? entry.preview_ready
        : league
          ? Number(entry.ready_stage) >= stage
          : entry.status === 'ready';
    const human = league?.humans.find((candidate) => candidate.participantId === entry.id) ?? null;
    const partial = leagueView?.standings?.find((candidate) => candidate.team === entry.team) ?? null;
    const awardsRevealed = stage >= 4;
    const recapRevealed = stage >= 10;
    return {
      seat: entry.seat,
      name: entry.name,
      isHost: raw.host_participant !== null && raw.host_participant === entry.id,
      isMe: entry.is_me,
      away: now - Date.parse(entry.last_seen) > AWAY_MS,
      status: entry.status,
      joinedAt: entry.joined_at,
      lastSeen: entry.last_seen,
      team: entry.team,
      rerollUsed: entry.reroll_used,
      build: entry.is_me ? parseBuild(entry.build) : null,
      summary: parseSummary(entry.build_summary),
      ready,
      season:
        league && human
          ? {
              wins: awardsRevealed ? human.wins : partial?.wins ?? 0,
              losses: awardsRevealed ? human.losses : partial?.losses ?? 0,
              seed: awardsRevealed ? human.seed : null,
              finish: recapRevealed ? human.finish : null,
              champion: recapRevealed ? human.champion : false,
            }
          : null,
    };
  });
  const me = participants.find((entry) => entry.isMe);
  if (!me) return null;
  const readyView: ReadyView = {
    ready: present.filter((entry) =>
      raw.phase === 'preview' ? entry.preview_ready : league ? Number(entry.ready_stage) >= stage : entry.status === 'ready',
    ).length,
    present: present.length,
    mine: me.ready,
  };
  const salary = settings.mode === 'salary' && raw.phase === 'building' && !league ? salaryView(board) : salaryView(null);
  return {
    code: raw.code,
    phase: raw.phase,
    version: Number(raw.version),
    settings,
    capacity: CAPACITY,
    seatsTaken: row.participants.filter((entry) => entry.status !== 'left').length,
    hostSeat: participants.find((entry) => entry.isHost)?.seat ?? null,
    stage,
    stageName: leagueView?.stageName ?? '',
    stageTotal: leagueView?.stageTotal ?? 0,
    stageCursor: cursor,
    checkpoint: leagueView?.checkpoint ?? false,
    stageStartedAt: raw.stage_started_at,
    participants,
    me,
    events: toEventViews(row),
    teams,
    ...salary,
    league: leagueView,
    ready: readyView,
    serverTime: new Date(now).toISOString(),
  };
}

export function buildLobbyDelta(view: LobbyView, sinceEvent: number): LobbyDelta {
  return {
    version: view.version,
    serverTime: view.serverTime,
    participants: view.participants.map((entry) => ({
      seat: entry.seat,
      status: entry.status,
      away: entry.away,
      summary: entry.summary,
      team: entry.team,
      ready: entry.ready,
    })),
    events: view.events.filter((event) => event.id > sinceEvent),
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
    'settings', l.settings, 'version', l.version, 'mode', l.mode, 'era', l.era,
    'league', l.league, 'stage', l.stage, 'stage_cursor', l.stage_cursor,
    'stage_started_at', l.stage_started_at, 'locked_at', l.locked_at, 'rematch', l.rematch,
    'season_secret', l.season_secret
  ) from l) as lobby,
  (select coalesce(json_agg(json_build_object(
    'id', p.id, 'name', p.name, 'seat', p.seat, 'status', p.status,
    'joined_at', p.joined_at, 'last_seen', p.last_seen,
    'is_me', p.token_hash = $2,
    'build', case when p.token_hash = $2 then p.build else null end,
    'build_kind', p.build_kind, 'build_summary', p.build_summary,
    'ready_stage', p.ready_stage, 'preview_ready', p.preview_ready,
    'team', t.team, 'reroll_used', coalesce(t.reroll_used, false)
  ) order by p.seat), '[]'::json) from participants p
    left join lobby_teams t on t.lobby_id = p.lobby_id and t.participant_id = p.id
    where p.lobby_id = (select id from l)) as participants,
  (select coalesce(json_agg(json_build_object(
    'id', e.id, 'kind', e.kind, 'payload', e.payload, 'participant_id', e.participant_id, 'at', e.created_at
  ) order by e.id desc), '[]'::json) from (
    select * from events where lobby_id = (select id from l) order by id desc limit ${EVENT_LIMIT}
  ) e) as events
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

async function maintain(row: ReadRow): Promise<void> {
  const raw = row.lobby;
  if (!raw) return;
  const now = Date.now();
  const present = row.participants.filter((entry) => entry.status !== 'left');
  const active = present.filter((entry) => now - Date.parse(entry.last_seen) <= AWAY_MS);
  const host = present.find((entry) => entry.id === raw.host_participant);
  if (!host || now - Date.parse(host.last_seen) > HOST_IDLE_MS) {
    await db().query(HOST_SQL, [raw.code, Math.floor(HOST_IDLE_MS / 1000)]);
  }
  if (raw.phase === 'draw') {
    return;
  }
  if (raw.phase === 'building') {
    if (active.length > 0 && active.every((entry) => entry.status === 'ready')) {
      await db().query(
        "update lobbies set phase = 'preview', version = version + 1, updated_at = now() where id = $1::uuid and phase = 'building'",
        [raw.id],
      );
    }
    return;
  }
  if (raw.phase === 'preview') {
    if (active.length > 0 && active.every((entry) => entry.preview_ready)) {
      await computeLeagueFor(raw.id);
    }
    return;
  }
  if (raw.phase !== 'season' && raw.phase !== 'awards' && raw.phase !== 'playin' && raw.phase !== 'playoffs') return;
  const league = parseLeague(raw.league);
  if (!league) return;
  const stage = Number(raw.stage);
  const startedAt = raw.stage_started_at ? Date.parse(raw.stage_started_at) : null;
  const cursor = Math.max(Number(raw.stage_cursor), stageCursorAt(league, stage, startedAt, now));
  if (cursor > Number(raw.stage_cursor)) {
    await db().query('update lobbies set stage_cursor = $2, version = version + 1, updated_at = now() where id = $1::uuid and stage = $3', [
      raw.id,
      cursor,
      stage,
    ]);
  }
  const total = stageTotal(league, stage);
  if (!isCheckpoint(stage, cursor, total)) return;
  if (active.length > 0 && active.every((entry) => Number(entry.ready_stage) >= stage)) {
    await advanceStage(raw.id, stage);
  }
}

function needsMaintenance(row: ReadRow, now: number): boolean {
  const raw = row.lobby;
  if (!raw) return false;
  const host = row.participants.find((entry) => entry.id === raw.host_participant);
  if (!host || host.status === 'left' || now - Date.parse(host.last_seen) > HOST_IDLE_MS) return true;
  const present = row.participants.filter((entry) => entry.status !== 'left');
  const active = present.filter((entry) => now - Date.parse(entry.last_seen) <= AWAY_MS);
  if (raw.phase === 'draw') return false;
  if (raw.phase === 'building') return active.length > 0 && active.every((entry) => entry.status === 'ready');
  if (raw.phase === 'preview') return active.length > 0 && active.every((entry) => entry.preview_ready);
  if (raw.phase !== 'season' && raw.phase !== 'awards' && raw.phase !== 'playin' && raw.phase !== 'playoffs') return false;
  const league = parseLeague(raw.league);
  if (!league) return false;
  const stage = Number(raw.stage);
  const startedAt = raw.stage_started_at ? Date.parse(raw.stage_started_at) : null;
  if (stageCursorAt(league, stage, startedAt, now) > Number(raw.stage_cursor)) return true;
  const total = stageTotal(league, stage);
  const cursor = Math.max(Number(raw.stage_cursor), stageCursorAt(league, stage, startedAt, now));
  if (!isCheckpoint(stage, cursor, total)) return false;
  return active.length > 0 && active.every((entry) => Number(entry.ready_stage) >= stage);
}

async function advanceStage(lobbyId: string, stage: number): Promise<void> {
  const next = Math.min(10, stage + 1);
  await db().query(
    `update lobbies set stage = $2, stage_cursor = 0, stage_started_at = now(), phase = $3, version = version + 1, updated_at = now()
     where id = $1::uuid and stage = $4`,
    [lobbyId, next, NEXT_PHASE[next] ?? 'recap', stage],
  );
  await db().query(
    `insert into events (lobby_id, kind, payload) values ($1::uuid, 'checkpoint', jsonb_build_object('detail', $2::text))`,
    [lobbyId, `checkpoint ${next}`],
  );
}

export async function readLobby(input: { code: string; secret: string }): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  try {
    const rows = await sql.query<ReadRow>(READ_SQL, [input.code, tokenHash]);
    let row = rows[0];
    if (!row?.lobby) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!row.participants.some((entry) => entry.is_me)) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    if (needsMaintenance(row, Date.now())) {
      await maintain(row);
      row = (await sql.query<ReadRow>(READ_SQL, [input.code, tokenHash]))[0];
      if (!row?.lobby) {
        return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
      }
    }
    const settings = parseSettings(row.lobby.settings);
    const board =
      settings.mode === 'salary' && row.lobby.phase === 'building' && !row.lobby.league
        ? salaryBoardFor(row.lobby.season_secret, await catalog())
        : null;
    const view = buildView(row, Date.now(), board);
    if (!view) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    return { ok: true, view };
  } catch (error) {
    return { ok: false, status: 503, error: serverError(error) };
  }
}

const CREATE_LOBBY_SQL = `
insert into lobbies (code, phase, settings, mode, era, version, create_action)
values ($1, 'lobby', $2::jsonb, $3, $4, 1, $5::uuid)
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
        input.settings.mode,
        input.settings.era,
        input.actionId,
      ]);
      const row = created[0] ?? (await sql.query<{ id: string; code: string }>(FIND_LOBBY_SQL, [input.actionId]))[0];
      if (!row) throw new Error('lobby insert returned no row');
      const participant = await sql.query<{ id: string; seat: number }>(CREATE_PARTICIPANT_SQL, [row.id, tokenHash, name]);
      const seatRow = participant[0];
      if (!seatRow) throw new Error('participant insert returned no row');
      await sql.query(CLAIM_HOST_SQL, [row.id, seatRow.id, name]);
      const outcome = await readLobby({ code: row.code, secret: input.secret });
      if (!outcome.ok) return outcome;
      return { ok: true, code: row.code, seat: seatRow.seat, participantId: seatRow.id, view: outcome.view };
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      return { ok: false, status: 503, error: serverError(error) };
    }
  }
  return { ok: false, status: 503, error: { error: 'Could not allocate a lobby code.', reason: 'server' } };
}

const JOIN_SQL = `
with l as (select id, phase from lobbies where code = $1),
mine as (
  select p.seat, p.status from participants p
  where p.lobby_id = (select id from l) and p.token_hash = $2
),
free_seat as (
  select s as seat from generate_series(1, $4::int) s
  where not exists (select 1 from participants p where p.lobby_id = (select id from l) and p.seat = s)
  order by s limit 1
),
target as (select coalesce((select seat from mine), (select seat from free_seat)) as seat),
seated as (
  insert into participants (lobby_id, token_hash, name, seat, status)
  select l.id, $2, $3, t.seat, case when m.seat is null then 'joined' else m.status end
  from l, target t
  left join mine m on true
  where t.seat is not null and (l.phase in ('lobby', 'draw') or m.seat is not null)
  on conflict (lobby_id, token_hash) do update
    set name = excluded.name, last_seen = now()
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
  from seated s where lob.id = (select id from l)
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

export async function joinLobby(input: { code: string; name: string; secret: string; actionId: string }): Promise<Outcome> {
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
        if (row.phase !== 'lobby' && row.phase !== 'draw') {
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
      return { ok: false, status: 503, error: serverError(error) };
    }
  }
  return { ok: false, status: 503, error: { error: 'Could not take a seat.', reason: 'server' } };
}

const START_SQL = `
with l as (select id, phase, host_participant from lobbies where code = $1),
me as (select p.id, p.seat, p.name from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'),
act as (
  insert into actions (participant_id, action_id, lobby_id)
  select me.id, $3::uuid, (select id from l) from me
  on conflict (participant_id, action_id) do nothing
  returning participant_id
),
started as (
  update lobbies lob set phase = 'draw', settings = $4::jsonb, mode = $5, era = $6, version = lob.version + 1, updated_at = now()
  from l, me
  where lob.id = l.id and lob.phase = 'lobby' and lob.host_participant = me.id and exists (select 1 from act)
  returning lob.id
),
log as (
  insert into events (lobby_id, participant_id, kind, payload)
  select (select id from l), (select id from me), 'started',
    jsonb_build_object('seat', (select seat from me), 'name', (select name from participants where id = (select id from me)), 'detail', $7::text)
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
  try {
    const rows = await sql.query<{
      lobby_id: string | null;
      phase: LobbyPhase | null;
      host: string | null;
      me_id: string | null;
      started: number;
      action_ok: boolean;
    }>(START_SQL, [
      input.code,
      tokenHash,
      input.actionId,
      JSON.stringify(input.settings),
      input.settings.mode,
      input.settings.era,
      `started a ${input.settings.mode} league`,
    ]);
    const row = rows[0];
    if (!row?.lobby_id) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!row.me_id) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    if (row.started === 0 && row.action_ok && row.phase !== 'lobby' && row.phase !== 'draw') {
      return { ok: false, status: 409, error: { error: 'This lobby already started.', reason: 'started' } };
    }
    if (row.started === 0 && row.action_ok && row.host !== row.me_id) {
      return { ok: false, status: 403, error: { error: 'Only the host can start the league.', reason: 'forbidden' } };
    }
    return readLobby({ code: input.code, secret: input.secret });
  } catch (error) {
    return { ok: false, status: 503, error: serverError(error) };
  }
}

async function recordAction(code: string, tokenHash: string, actionId: string): Promise<void> {
  await db().query(
    `insert into actions (participant_id, action_id, lobby_id)
     select p.id, $3::uuid, p.lobby_id from participants p
     where p.lobby_id = (select id from lobbies where code = $1) and p.token_hash = $2 and p.status <> 'left'
     on conflict do nothing`,
    [code, tokenHash, actionId],
  );
}

interface DrawContext {
  lobby_id: string;
  phase: LobbyPhase;
  me_id: string | null;
  team: string | null;
  reroll_used: boolean;
}

async function drawContext(code: string, tokenHash: string): Promise<DrawContext | null> {
  const rows = await db().query<DrawContext>(
    `select l.id as lobby_id, l.phase, p.id as me_id, t.team, coalesce(t.reroll_used, false) as reroll_used
     from lobbies l
     left join participants p on p.lobby_id = l.id and p.token_hash = $2 and p.status <> 'left'
     left join lobby_teams t on t.lobby_id = l.id and t.participant_id = p.id
     where l.code = $1`,
    [code, tokenHash],
  );
  return rows[0] ?? null;
}

async function claimedTeams(lobbyId: string): Promise<Set<string>> {
  const rows = await db().query<{ team: string }>('select team from lobby_teams where lobby_id = $1::uuid', [lobbyId]);
  return new Set(rows.map((row) => row.team));
}

function pickFree(taken: Set<string>, exclude: string | null): string | null {
  const free = LEAGUE_TEAMS.filter((team) => team !== exclude && !taken.has(team));
  if (!free.length) return null;
  return free[Math.floor(Math.random() * free.length)] ?? null;
}

export async function drawTeam(input: { code: string; secret: string; actionId: string }): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  await recordAction(input.code, tokenHash, input.actionId);
  for (let attempt = 0; attempt < 12; attempt++) {
    const context = await drawContext(input.code, tokenHash);
    if (!context) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!context.me_id) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    if (context.team) return readLobby({ code: input.code, secret: input.secret });
    if (context.phase !== 'draw') {
      return { ok: false, status: 409, error: { error: 'The team draw is closed.', reason: 'conflict' } };
    }
    const pick = pickFree(await claimedTeams(context.lobby_id), null);
    if (!pick) {
      return { ok: false, status: 409, error: { error: 'Every team is claimed.', reason: 'conflict' } };
    }
    try {
      const inserted = await sql.query<{ team: string }>(
        `insert into lobby_teams (lobby_id, participant_id, team) values ($1::uuid, $2::uuid, $3)
         on conflict do nothing returning team`,
        [context.lobby_id, context.me_id, pick],
      );
      if (inserted[0]) return readLobby({ code: input.code, secret: input.secret });
    } catch (error) {
      if (!isUniqueViolation(error)) return { ok: false, status: 503, error: serverError(error) };
    }
  }
  return { ok: false, status: 503, error: { error: 'Could not draw a team.', reason: 'server' } };
}

export async function rerollTeam(input: { code: string; secret: string; actionId: string }): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  await recordAction(input.code, tokenHash, input.actionId);
  for (let attempt = 0; attempt < 12; attempt++) {
    const context = await drawContext(input.code, tokenHash);
    if (!context) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!context.me_id) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    if (context.reroll_used) return readLobby({ code: input.code, secret: input.secret });
    if (context.phase !== 'draw') {
      return { ok: false, status: 409, error: { error: 'The team draw is closed.', reason: 'conflict' } };
    }
    if (!context.team) {
      return { ok: false, status: 409, error: { error: 'Draw a team first.', reason: 'conflict' } };
    }
    const pick = pickFree(await claimedTeams(context.lobby_id), context.team);
    if (!pick) {
      return { ok: false, status: 409, error: { error: 'Every team is claimed.', reason: 'conflict' } };
    }
    try {
      const updated = await sql.query<{ team: string }>(
        `update lobby_teams set team = $3, reroll_used = true
         where lobby_id = $1::uuid and participant_id = $2::uuid and not reroll_used and team = $4
         returning team`,
        [context.lobby_id, context.me_id, pick, context.team],
      );
      if (updated[0]) return readLobby({ code: input.code, secret: input.secret });
    } catch (error) {
      if (!isUniqueViolation(error)) return { ok: false, status: 503, error: serverError(error) };
    }
  }
  return { ok: false, status: 503, error: { error: 'Could not reroll a team.', reason: 'server' } };
}

const LOCK_SQL = `
with l as (select id, phase, host_participant from lobbies where code = $1),
me as (select p.id from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'),
act as (
  insert into actions (participant_id, action_id, lobby_id)
  select me.id, $3::uuid, (select id from l) from me
  on conflict (participant_id, action_id) do nothing
  returning participant_id
),
locked as (
  update lobbies lob set phase = 'building', locked_at = coalesce(locked_at, now()), version = lob.version + 1, updated_at = now()
  from l, me
  where lob.id = l.id and lob.phase = 'draw' and lob.host_participant = me.id and exists (select 1 from act)
  returning lob.id
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select host_participant from l) as host,
  (select id from me) as me_id,
  (select count(*)::int from locked) as locked,
  exists (select 1 from act) as action_ok
`;

async function drawRemaining(lobbyId: string): Promise<void> {
  const rows = await db().query<{ id: string }>(
    `select p.id from participants p
     where p.lobby_id = $1::uuid and p.status <> 'left'
       and not exists (select 1 from lobby_teams t where t.lobby_id = p.lobby_id and t.participant_id = p.id)`,
    [lobbyId],
  );
  for (const row of rows) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const inserted = await db().query<{ team: string }>(
        `insert into lobby_teams (lobby_id, participant_id, team)
         select $1::uuid, $2::uuid, candidate.team
         from (select team from unnest($3::text[]) as team
               where not exists (select 1 from lobby_teams lt where lt.lobby_id = $1::uuid and lt.team = team)
               order by random() limit 1) candidate
         on conflict do nothing
         returning team`,
        [lobbyId, row.id, LEAGUE_TEAMS],
      );
      if (inserted[0]) break;
    }
  }
}

export async function lockTeams(input: { code: string; secret: string; actionId: string }): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  try {
    const existing = await sql.query<LobbyContextRow>('select id, phase from lobbies where code = $1', [input.code]);
    const lobby = existing[0];
    if (!lobby) return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    if (lobby.phase === 'draw') await drawRemaining(lobby.id);
    const rows = await sql.query<{
      lobby_id: string | null;
      phase: LobbyPhase | null;
      host: string | null;
      me_id: string | null;
      locked: number;
      action_ok: boolean;
    }>(LOCK_SQL, [input.code, tokenHash, input.actionId]);
    const row = rows[0];
    if (!row?.lobby_id) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!row.me_id) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    if (row.locked === 0 && row.action_ok && row.phase !== 'building') {
      return { ok: false, status: 403, error: { error: 'Only the host can lock the teams.', reason: 'forbidden' } };
    }
    return readLobby({ code: input.code, secret: input.secret });
  } catch (error) {
    return { ok: false, status: 503, error: serverError(error) };
  }
}

const BUILD_SQL = `
with l as (select id, phase from lobbies where code = $1),
me as (
  select p.id, p.seat, p.name, p.status, p.build from participants p
  where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'
),
act as (
  insert into actions (participant_id, action_id, lobby_id)
  select me.id, $3::uuid, (select id from l) from me
  on conflict (participant_id, action_id) do nothing
  returning participant_id
),
seen as (select 1 from actions a, me where a.participant_id = me.id and a.action_id = $3::uuid),
written as (
  update participants p
  set build = $4::jsonb, build_kind = $5, build_summary = $6::jsonb, status = 'ready', last_seen = now()
  from me, act, l
  where p.id = me.id and act.participant_id = me.id and l.phase = 'building' and me.build is null
  returning p.id
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select id from me) as me_id,
  (select status from me) as status,
  (select count(*)::int from written) as written,
  exists (select 1 from act) as action_ok,
  exists (select 1 from seen) as action_seen
`;

export async function submitBuild(input: {
  code: string;
  secret: string;
  actionId: string;
  build: LobbyBuild;
}): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  try {
    const context = await sql.query<{
      id: string;
      phase: LobbyPhase;
      mode: string;
      era: string;
      season_secret: string;
      team: string | null;
      me_id: string | null;
      has_build: boolean | null;
    }>(
      `select l.id, l.phase, l.mode, l.era, l.season_secret, t.team, p.id as me_id, (p.build is not null) as has_build
       from lobbies l
       left join participants p on p.lobby_id = l.id and p.token_hash = $2 and p.status <> 'left'
       left join lobby_teams t on t.lobby_id = l.id and t.participant_id = p.id
       where l.code = $1`,
      [input.code, tokenHash],
    );
    const row = context[0];
    if (!row) return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    if (!row.me_id) return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    if (row.phase !== 'building') {
      return { ok: false, status: 409, error: { error: 'The build window is closed.', reason: 'conflict' } };
    }
    if (!row.team) {
      return { ok: false, status: 409, error: { error: 'Draw a team first.', reason: 'conflict' } };
    }
    const settings: LobbySettings = {
      era: row.era === 'alltime' ? 'alltime' : 'current',
      mode: row.mode as LeagueMode,
    };
    const data = await catalog();
    const checked = validateBuild(input.build, settings, data, row.team, row.season_secret);
    if (!checked.ok) return { ok: false, status: 400, error: { error: checked.error, reason: 'invalid' } };
    const result = await sql.query<{
      lobby_id: string | null;
      phase: LobbyPhase | null;
      me_id: string | null;
      status: ParticipantStatus | null;
      written: number;
      action_ok: boolean;
      action_seen: boolean;
    }>(BUILD_SQL, [
      input.code,
      tokenHash,
      input.actionId,
      JSON.stringify(checked.build),
      checked.build.kind,
      JSON.stringify(checked.summary),
    ]);
    const written = result[0];
    if (!written?.lobby_id) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!written.me_id) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    if (written.written === 0) {
      if (written.action_ok || written.action_seen) return readLobby({ code: input.code, secret: input.secret });
      return { ok: false, status: 409, error: { error: 'Your build is already in.', reason: 'conflict' } };
    }
    return readLobby({ code: input.code, secret: input.secret });
  } catch (error) {
    return { ok: false, status: 503, error: serverError(error) };
  }
}

const READY_SQL = `
with l as (select id, phase, stage from lobbies where code = $1),
me as (select p.id from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'),
act as (
  insert into actions (participant_id, action_id, lobby_id)
  select me.id, $3::uuid, (select id from l) from me
  on conflict (participant_id, action_id) do nothing
  returning participant_id
),
marked as (
  update participants p set
    ready_stage = case when l.phase in ('season', 'awards', 'playin', 'playoffs') then $4 else p.ready_stage end,
    preview_ready = case when l.phase = 'preview' then true else p.preview_ready end,
    last_seen = now()
  from me, act, l
  where p.id = me.id and act.participant_id = me.id
    and (l.phase = 'preview' or (l.phase in ('season', 'awards', 'playin', 'playoffs') and l.stage = $4))
  returning p.id
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select stage from l) as stage,
  (select id from me) as me_id,
  (select count(*)::int from marked) as marked,
  exists (select 1 from act) as action_ok
`;

export async function readyLobby(input: { code: string; secret: string; actionId: string; stage: number }): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  try {
    const rows = await sql.query<{
      lobby_id: string | null;
      phase: LobbyPhase | null;
      stage: number | string | null;
      me_id: string | null;
      marked: number;
      action_ok: boolean;
    }>(READY_SQL, [input.code, tokenHash, input.actionId, input.stage]);
    const row = rows[0];
    if (!row?.lobby_id) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!row.me_id) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    if (Number(row.stage) !== input.stage) return readLobby({ code: input.code, secret: input.secret });
    return readLobby({ code: input.code, secret: input.secret });
  } catch (error) {
    return { ok: false, status: 503, error: serverError(error) };
  }
}

const ADVANCE_SQL = `
with l as (select id, phase, stage, host_participant from lobbies where code = $1),
me as (select p.id from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'),
act as (
  insert into actions (participant_id, action_id, lobby_id)
  select me.id, $3::uuid, (select id from l) from me
  on conflict (participant_id, action_id) do nothing
  returning participant_id
),
present as (
  select count(*)::int as n from participants p
  where p.lobby_id = (select id from l) and p.status <> 'left'
    and p.last_seen > now() - make_interval(secs => $6::int)
),
ready as (
  select count(*)::int as n from participants p
  where p.lobby_id = (select id from l) and p.status <> 'left'
    and p.last_seen > now() - make_interval(secs => $6::int)
    and p.ready_stage >= $4
),
advanced as (
  update lobbies lob set stage = lob.stage + 1, stage_cursor = 0, stage_started_at = now(),
    phase = $5, version = lob.version + 1, updated_at = now()
  from l, me, act
  where lob.id = l.id and l.stage = $4 and act.participant_id = me.id
    and l.phase in ('season', 'awards', 'playin', 'playoffs')
    and (l.host_participant = me.id or (select n from ready) = (select n from present))
  returning lob.id
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select stage from l) as stage,
  (select id from me) as me_id,
  (select n from present) as present,
  (select n from ready) as ready,
  (select count(*)::int from advanced) as advanced,
  exists (select 1 from act) as action_ok
`;

export async function advanceLobby(input: { code: string; secret: string; actionId: string; stage: number }): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  try {
    const phaseRows = await sql.query<{ id: string; phase: LobbyPhase }>('select id, phase from lobbies where code = $1', [input.code]);
    const phaseRow = phaseRows[0];
    if (!phaseRow) return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    if (phaseRow.phase === 'preview') {
      const preview = await sql.query<{ lobby_id: string | null; me_id: string | null; host: string | null; action_ok: boolean }>(
        `with l as (select id, phase, host_participant from lobbies where code = $1),
         me as (select p.id from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'),
         act as (
           insert into actions (participant_id, action_id, lobby_id)
           select me.id, $3::uuid, (select id from l) from me
           on conflict (participant_id, action_id) do nothing
           returning participant_id
         )
         select (select id from l) as lobby_id, (select id from me) as me_id,
           (select host_participant from l) as host,
           (select count(*)::int from act) as action_ok`,
        [input.code, tokenHash, input.actionId],
      );
      const row = preview[0];
      if (!row?.lobby_id) {
        return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
      }
      if (!row.me_id) {
        return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
      }
      if (row.host !== row.me_id) {
        return { ok: false, status: 403, error: { error: 'Only the host can start the season.', reason: 'forbidden' } };
      }
      await computeLeagueFor(phaseRow.id);
      return readLobby({ code: input.code, secret: input.secret });
    }
    const context = await sql.query<LobbyContextRow>(
      'select id, phase, stage, stage_cursor, stage_started_at, host_participant, mode, era, season_secret from lobbies where code = $1',
      [input.code],
    );
    const lobby = context[0];
    if (!lobby) return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    const stage = Number(lobby.stage);
    const league = await sql.query<{ league: unknown }>('select league from lobbies where id = $1::uuid', [lobby.id]);
    const parsed = parseLeague(league[0]?.league);
    if (!parsed) return { ok: false, status: 409, error: { error: 'The season has not started.', reason: 'conflict' } };
    const cursor = Math.max(
      Number(lobby.stage_cursor),
      stageCursorAt(parsed, stage, lobby.stage_started_at ? Date.parse(lobby.stage_started_at) : null, Date.now()),
    );
    if (input.stage !== stage) return readLobby({ code: input.code, secret: input.secret });
    if (!isCheckpoint(stage, cursor, stageTotal(parsed, stage))) {
      return { ok: false, status: 409, error: { error: 'This checkpoint is still revealing.', reason: 'conflict' } };
    }
    const next = Math.min(10, stage + 1);
    const rows = await sql.query<{
      lobby_id: string | null;
      phase: LobbyPhase | null;
      stage: number | string | null;
      me_id: string | null;
      present: number;
      ready: number;
      advanced: number;
      action_ok: boolean;
    }>(ADVANCE_SQL, [
      input.code,
      tokenHash,
      input.actionId,
      stage,
      NEXT_PHASE[next] ?? 'recap',
      Math.floor(AWAY_MS / 1000),
    ]);
    const row = rows[0];
    if (!row?.lobby_id) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!row.me_id) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    if (row.advanced > 0) {
      await sql.query(
        `insert into events (lobby_id, kind, payload) values ($1::uuid, 'checkpoint', jsonb_build_object('detail', $2::text))`,
        [row.lobby_id, `checkpoint ${next}`],
      );
      return readLobby({ code: input.code, secret: input.secret });
    }
    if (!row.action_ok) return readLobby({ code: input.code, secret: input.secret });
    return {
      ok: false,
      status: 409,
      error: { error: `Waiting on ${Math.max(0, row.present - row.ready)} player${row.present - row.ready === 1 ? '' : 's'}.`, reason: 'conflict' },
    };
  } catch (error) {
    return { ok: false, status: 503, error: serverError(error) };
  }
}

const REMATCH_SQL = `
with l as (select id, phase, host_participant from lobbies where code = $1),
me as (select p.id from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'),
act as (
  insert into actions (participant_id, action_id, lobby_id)
  select me.id, $3::uuid, (select id from l) from me
  on conflict (participant_id, action_id) do nothing
  returning participant_id
),
seen as (select 1 from actions a, me where a.participant_id = me.id and a.action_id = $3::uuid),
ok as (select 1 from l, me, act where l.host_participant = me.id and l.phase = 'recap' and act.participant_id = me.id),
reset_p as (
  update participants p set build = null, build_kind = null, build_summary = null, status = 'joined',
    ready_stage = -1, preview_ready = false, last_seen = now()
  where p.lobby_id = (select id from l) and p.status <> 'left' and exists (select 1 from ok)
  returning p.id
),
del_t as (delete from lobby_teams where lobby_id = (select id from l) and exists (select 1 from ok)),
del_g as (delete from league_games where lobby_id = (select id from l) and exists (select 1 from ok)),
reset_l as (
  update lobbies set phase = 'draw', league = null, stage = 0, stage_cursor = 0, stage_started_at = null,
    locked_at = null, rematch = rematch + 1, version = version + 1, updated_at = now()
  where id = (select id from l) and exists (select 1 from ok)
  returning id
)
select
  (select id from l) as lobby_id,
  (select count(*)::int from reset_l) as reset,
  (select count(*)::int from act) as action_ok,
  exists (select 1 from seen) as action_seen
`;

export async function rematchLobby(input: { code: string; secret: string; actionId: string }): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  try {
    const rows = await sql.query<{ lobby_id: string | null; reset: number; action_ok: number; action_seen: boolean }>(REMATCH_SQL, [
      input.code,
      tokenHash,
      input.actionId,
    ]);
    const row = rows[0];
    if (!row?.lobby_id) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (row.reset === 0 && row.action_seen) return readLobby({ code: input.code, secret: input.secret });
    if (row.reset === 0 && row.action_ok === 0) {
      return { ok: false, status: 409, error: { error: 'Only the host can start a rematch.', reason: 'forbidden' } };
    }
    if (row.reset === 0) {
      return { ok: false, status: 409, error: { error: 'This league is not finished.', reason: 'conflict' } };
    }
    return readLobby({ code: input.code, secret: input.secret });
  } catch (error) {
    return { ok: false, status: 503, error: serverError(error) };
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
  delete from participants p using me, act, l
  where p.id = me.id and act.participant_id = me.id and l.phase in ('lobby', 'draw')
  returning p.id, p.seat, p.name
),
marked as (
  update participants p set status = 'left', last_seen = now()
  from me, act, l
  where p.id = me.id and act.participant_id = me.id and l.phase not in ('lobby', 'draw') and p.status <> 'left'
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
    const outcome = await readLobby({ code: input.code, secret: input.secret });
    return outcome.ok ? outcome : { ok: true, view: null };
  } catch (error) {
    return { ok: false, status: 503, error: serverError(error) };
  }
}

interface LeagueParticipantRow {
  id: string;
  name: string;
  seat: number;
  build: unknown;
  team: string;
}

interface GameRow {
  game_no: number;
  kind: string;
  stage: number;
  home: string;
  away: string;
  home_score: number;
  away_score: number;
  winner: string;
}

export async function computeLeagueFor(lobbyId: string): Promise<void> {
  const sql = db();
  const lobbyRows = await sql.query<{
    id: string;
    settings: unknown;
    mode: string;
    era: string;
    season_secret: string;
    league: unknown;
    phase: LobbyPhase;
  }>('select id, settings, mode, era, season_secret, league, phase from lobbies where id = $1::uuid', [lobbyId]);
  const lobby = lobbyRows[0];
  if (!lobby || lobby.league || lobby.phase !== 'preview') return;
  const settings = parseSettings(lobby.settings);
  const rows = await sql.query<LeagueParticipantRow>(
    `select p.id, p.name, p.seat, p.build, t.team
     from participants p join lobby_teams t on t.lobby_id = p.lobby_id and t.participant_id = p.id
     where p.lobby_id = $1::uuid and p.status <> 'left' order by p.seat`,
    [lobbyId],
  );
  const data = await catalog();
  const humans: HumanTeamInput[] = [];
  for (const row of rows) {
    const build = parseBuild(row.build);
    if (!build) continue;
    const power = powerFromBuild(build, settings, data, row.team);
    humans.push({
      participantId: row.id,
      seat: row.seat,
      name: row.name,
      team: row.team,
      position: power.position,
      ovr: power.ovr,
      values: power.values,
      squadStrength: power.squadStrength,
      squadPlayers: power.squadPlayers,
    });
  }
  if (!humans.length) return;
  const league = simulateLeague({ seed: lobby.season_secret, era: settings.era, mode: settings.mode, humans });
  const games: GameRow[] = league.games.map((game) => ({
    game_no: game.gameNo,
    kind: 'regular',
    stage: game.stage,
    home: game.home,
    away: game.away,
    home_score: game.homeScore,
    away_score: game.awayScore,
    winner: game.winner,
  }));
  let nextNo = league.games.length + 1;
  for (const game of league.playin) {
    games.push({
      game_no: nextNo++,
      kind: 'playin',
      stage: 5,
      home: game.home,
      away: game.away,
      home_score: game.homeScore,
      away_score: game.awayScore,
      winner: game.winner,
    });
  }
  for (const series of league.series) {
    for (const game of series.games) {
      games.push({
        game_no: nextNo++,
        kind: 'playoff',
        stage: series.round + 5,
        home: game.home,
        away: game.away,
        home_score: game.homeScore,
        away_score: game.awayScore,
        winner: game.winner,
      });
    }
  }
  const updated = await sql.query<{ id: string }>(
    `update lobbies set phase = 'season', stage = 0, stage_cursor = 0, stage_started_at = now(),
       league = $2::jsonb, locked_at = coalesce(locked_at, now()), version = version + 1, updated_at = now()
     where id = $1::uuid and league is null and phase = 'preview'
     returning id`,
    [lobbyId, JSON.stringify(league)],
  );
  if (!updated[0]) return;
  await sql.query(
    `insert into league_games (lobby_id, game_no, kind, stage, home, away, home_score, away_score, winner)
     select $1::uuid, x.game_no, x.kind, x.stage, x.home, x.away, x.home_score, x.away_score, x.winner
     from jsonb_to_recordset($2::jsonb) as x(game_no int, kind text, stage int, home text, away text, home_score int, away_score int, winner text)
     on conflict (lobby_id, game_no) do nothing`,
    [lobbyId, JSON.stringify(games)],
  );
}
