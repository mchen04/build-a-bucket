import * as v from 'valibot';
import { LEAGUE_TEAMS, simulateLeague, type HumanTeamInput, type LeagueResult } from '../shared/engine/league.js';
import { seededRng } from '../shared/engine/rng.js';
import type { SalCard } from '../shared/engine/salary.js';
import { scoutGrade, shuffleColumn, shuffleRow, type ShuffleTarget } from '../shared/engine/salaryPowers.js';
import { cleanName, generateCode, hashSecret } from '../shared/mp/codes.js';
import { isCheckpoint, revealLeague, stageCursorAt, stageGamesTotal } from '../shared/mp/league.js';
import { BuildSummarySchema, LobbyBuildSchema, SettingsSchema } from '../shared/mp/schemas.js';
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
  type SalaryPowersView,
  type TeamAssignmentView,
} from '../shared/mp/types.js';
import {
  autoBuild,
  buildSeedFor,
  catalog,
  powerFromBuild,
  salaryBoardFor,
  validateBuild,
  type SalaryBoard,
} from './league.js';
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

type LobbyRow = Omit<RawLobby, 'league'>;

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
  salary_powers: unknown;
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

interface SalaryPowersState {
  shuffle: boolean;
  scout: boolean;
  grid: SalCard[][] | null;
  scouted: Record<string, string>;
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
  return parsed.success ? (parsed.output as BuildSummary) : null;
}

function parseLeague(raw: unknown): LeagueResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<LeagueResult>;
  if (!Array.isArray(candidate.games) || !candidate.standings || !Array.isArray(candidate.humans)) return null;
  return candidate as LeagueResult;
}

function parsePowers(raw: unknown): SalaryPowersState {
  if (!raw || typeof raw !== 'object') return { shuffle: false, scout: false, grid: null, scouted: {} };
  const candidate = raw as Partial<SalaryPowersState>;
  return {
    shuffle: candidate.shuffle === true,
    scout: candidate.scout === true,
    grid: Array.isArray(candidate.grid) ? (candidate.grid as SalCard[][]) : null,
    scouted:
      candidate.scouted && typeof candidate.scouted === 'object'
        ? (candidate.scouted as Record<string, string>)
        : {},
  };
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

function salaryGridView(grid: SalCard[][] | null): SalaryCardPick[][] | null {
  if (!grid) return null;
  return grid.map((column) =>
    column.map((card) => ({
      id: card.id,
      name: card.name,
      team: card.team,
      price: card.price,
      attrs: card.attrs,
      fullAttrs: card.fullAttrs,
      posGroup: card.posGroup,
    })),
  );
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
      raw.phase === 'preview' || raw.phase === 'rematch'
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
      buildSeed: entry.is_me ? buildSeedFor(raw.season_secret, entry.id) : null,
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
      raw.phase === 'preview' || raw.phase === 'rematch'
        ? entry.preview_ready
        : league
          ? Number(entry.ready_stage) >= stage
          : entry.status === 'ready',
    ).length,
    present: present.length,
    mine: me.ready,
  };
  const powers = parsePowers(meRow.salary_powers);
  const salaryOpen = settings.mode === 'salary' && raw.phase === 'building' && !league && board !== null;
  const salaryPowers: SalaryPowersView | null = salaryOpen
    ? { shuffle: powers.shuffle, scout: powers.scout, scouted: powers.scouted }
    : null;
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
    salaryBoard: salaryOpen && board ? salaryGridView(powers.grid ?? board.grid) : null,
    salaryBudget: salaryOpen && board ? board.budget : null,
    salaryPowers,
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
    'team', t.team, 'reroll_used', coalesce(t.reroll_used, false),
    'salary_powers', case when p.token_hash = $2 then p.salary_powers else null end
  ) order by p.seat), '[]'::json) from participants p
    left join lobby_teams t on t.lobby_id = p.lobby_id and t.participant_id = p.id
    where p.lobby_id = (select id from l)) as participants,
  (select coalesce(json_agg(json_build_object(
    'id', e.id, 'kind', e.kind, 'payload', e.payload, 'participant_id', e.participant_id, 'at', e.created_at
  ) order by e.id desc), '[]'::json) from (
    select * from events where lobby_id = (select id from l) order by id desc limit ${EVENT_LIMIT}
  ) e) as events
`;

const LOBBY_ROW_SQL = `
select id, code, phase, host_participant, settings, version, mode, era, stage, stage_cursor,
  stage_started_at, locked_at, rematch, season_secret
from lobbies where code = $1
`;

const EVENTS_SQL = `
select coalesce(json_agg(json_build_object(
  'id', e.id, 'kind', e.kind, 'payload', e.payload, 'participant_id', e.participant_id, 'at', e.created_at
) order by e.id desc), '[]'::json) as events
from (select * from events where lobby_id = (select id from lobbies where code = $1) order by id desc limit ${EVENT_LIMIT}) e
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

const AUTO_LOCK_SQL = `
with l as (select id, phase from lobbies where code = $1 for update),
present as (
  select p.id, t.team from participants p
  left join lobby_teams t on t.lobby_id = p.lobby_id and t.participant_id = p.id
  where p.lobby_id = (select id from l) and p.status <> 'left'
    and p.last_seen > now() - make_interval(secs => $2::int)
),
missing as (
  select id, row_number() over (order by seat) as rn from (
    select p.id, p.seat from participants p
    where p.lobby_id = (select id from l) and p.status <> 'left'
      and not exists (select 1 from lobby_teams t where t.lobby_id = p.lobby_id and t.participant_id = p.id)
    for update
  ) locked
),
free as (
  select team, row_number() over (order by random()) as rn
  from unnest($3::text[]) as candidate(team)
  where not exists (select 1 from lobby_teams t where t.lobby_id = (select id from l) and t.team = candidate.team)
),
assigned as (
  insert into lobby_teams (lobby_id, participant_id, team)
  select (select id from l), m.id, f.team
  from missing m join free f on f.rn = m.rn
  where (select phase from l) = 'draw'
  on conflict do nothing
  returning participant_id
),
locked as (
  update lobbies set phase = 'building', locked_at = coalesce(locked_at, now()),
    version = version + 1, updated_at = now()
  where id = (select id from l) and phase = 'draw'
    and (select count(*) from present) >= 2
    and not exists (select 1 from present where team is null)
  returning id
),
log as (
  insert into events (lobby_id, kind, payload)
  select id, 'locked', jsonb_build_object('detail', 'locked the teams') from locked
)
select (select count(*)::int from locked) as locked
`;

const BUILDING_PREVIEW_SQL = `
update lobbies set phase = 'preview', version = version + 1, updated_at = now()
where id = $1::uuid and phase = 'building'
  and not exists (
    select 1 from participants p
    where p.lobby_id = $1::uuid and p.status <> 'left'
      and p.last_seen > now() - make_interval(secs => $2::int)
      and p.status <> 'ready'
  )
returning id
`;

const REMATCH_DRAW_SQL = `
update lobbies set phase = 'draw', version = version + 1, updated_at = now()
where id = $1::uuid and phase = 'rematch'
  and (select count(*) from participants p where p.lobby_id = $1::uuid and p.status <> 'left') >= 2
  and not exists (
    select 1 from participants p where p.lobby_id = $1::uuid and p.status <> 'left' and not p.preview_ready
  )
returning id
`;

async function autoCompleteMissing(
  lobby: { id: string; season_secret: string; mode: string; era: string },
  data: Awaited<ReturnType<typeof catalog>>,
): Promise<void> {
  const settings: LobbySettings = {
    era: lobby.era === 'alltime' ? 'alltime' : 'current',
    mode: lobby.mode as LeagueMode,
  };
  const rows = await db().query<{ id: string; name: string; team: string; build: unknown }>(
    `select p.id, p.name, t.team, p.build
     from participants p join lobby_teams t on t.lobby_id = p.lobby_id and t.participant_id = p.id
     where p.lobby_id = $1::uuid and p.status <> 'left'`,
    [lobby.id],
  );
  for (const row of rows) {
    if (row.build) continue;
    const check = autoBuild(settings, data, row.team, buildSeedFor(lobby.season_secret, row.id), lobby.season_secret);
    if (!check.ok) continue;
    const updated = await db().query<{ id: string }>(
      `update participants set build = $2::jsonb, build_kind = $3, build_summary = $4::jsonb,
         status = 'ready', last_seen = now()
       where id = $1::uuid and build is null and status <> 'left'
         and exists (
           select 1 from lobbies l
           where l.id = (select p2.lobby_id from participants p2 where p2.id = $1::uuid)
             and l.phase in ('building', 'preview')
         )
       returning id`,
      [row.id, JSON.stringify(check.build), check.build.kind, JSON.stringify(check.summary)],
    );
    if (updated[0]) {
      await db().query(
        `insert into events (lobby_id, participant_id, kind, payload)
         values ($1::uuid, $2::uuid, 'auto_build', jsonb_build_object('name', $3::text, 'detail', 'build auto-filled'))`,
        [lobby.id, row.id, row.name],
      );
    }
  }
}

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
    if (active.length < 2 || active.some((entry) => !entry.team)) return;
    await db().query(AUTO_LOCK_SQL, [raw.code, Math.floor(AWAY_MS / 1000), LEAGUE_TEAMS]);
    return;
  }
  if (raw.phase === 'building') {
    if (active.length === 0 || !active.every((entry) => entry.status === 'ready')) return;
    const data = await catalog();
    await autoCompleteMissing(raw, data);
    const updated = await db().query<{ id: string }>(BUILDING_PREVIEW_SQL, [raw.id, Math.floor(AWAY_MS / 1000)]);
    if (updated[0]) {
      await db().query(
        `insert into events (lobby_id, kind, payload)
         values ($1::uuid, 'preview', jsonb_build_object('detail', 'opened the team preview'))`,
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
  if (raw.phase === 'rematch') {
    if (present.length < 2 || !present.every((entry) => entry.preview_ready)) return;
    const updated = await db().query<{ id: string }>(REMATCH_DRAW_SQL, [raw.id]);
    if (updated[0]) {
      await db().query(
        `insert into events (lobby_id, kind, payload)
         values ($1::uuid, 'draw', jsonb_build_object('detail', 'opened the team draw'))`,
        [raw.id],
      );
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
    await db().query(
      `update lobbies set stage_cursor = greatest(stage_cursor, $2), version = version + 1, updated_at = now()
       where id = $1::uuid and stage = $3`,
      [raw.id, cursor, stage],
    );
  }
  const total = stageGamesTotal(league, stage);
  if (!isCheckpoint(cursor, total)) return;
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
  if (raw.phase === 'draw') return active.length >= 2 && active.every((entry) => entry.team);
  if (raw.phase === 'building') return active.length > 0 && active.every((entry) => entry.status === 'ready');
  if (raw.phase === 'preview') return active.length > 0 && active.every((entry) => entry.preview_ready);
  if (raw.phase === 'rematch') return present.length >= 2 && present.every((entry) => entry.preview_ready);
  if (raw.phase !== 'season' && raw.phase !== 'awards' && raw.phase !== 'playin' && raw.phase !== 'playoffs') return false;
  const league = parseLeague(raw.league);
  if (!league) return false;
  const stage = Number(raw.stage);
  const startedAt = raw.stage_started_at ? Date.parse(raw.stage_started_at) : null;
  if (stageCursorAt(league, stage, startedAt, now) > Number(raw.stage_cursor)) return true;
  const total = stageGamesTotal(league, stage);
  const cursor = Math.max(Number(raw.stage_cursor), stageCursorAt(league, stage, startedAt, now));
  if (!isCheckpoint(cursor, total)) return false;
  return active.length > 0 && active.every((entry) => Number(entry.ready_stage) >= stage);
}

async function advanceStage(lobbyId: string, stage: number): Promise<void> {
  const next = Math.min(10, stage + 1);
  const updated = await db().query<{ id: string }>(
    `update lobbies set stage = $2, stage_cursor = 0, stage_started_at = now(), phase = $3,
       version = version + 1, updated_at = now()
     where id = $1::uuid and stage = $4 returning id`,
    [lobbyId, next, NEXT_PHASE[next] ?? 'recap', stage],
  );
  if (!updated[0]) return;
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
      const before = row.lobby;
      await maintain(row);
      const fresh = await sql.query<LobbyRow>(LOBBY_ROW_SQL, [input.code]);
      if (fresh[0]) {
        if (fresh[0].phase !== before.phase) {
          row = (await sql.query<ReadRow>(READ_SQL, [input.code, tokenHash]))[0] ?? row;
        } else {
          row = { ...row, lobby: { ...before, ...fresh[0] } };
          const events = await sql.query<{ events: RawEvent[] }>(EVENTS_SQL, [input.code]);
          row = { ...row, events: events[0]?.events ?? row.events };
        }
      }
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
with l as (select id, phase from lobbies where code = $1 for update),
mine as (select p.id, p.seat, p.status from participants p where p.lobby_id = (select id from l) and p.token_hash = $2),
free_seat as (
  select s as seat from generate_series(1, $4::int) s
  where not exists (select 1 from participants p where p.lobby_id = (select id from l) and p.seat = s)
  order by s limit 1
),
rejoined as (
  update participants p set name = $3, last_seen = now(),
    status = case when p.status = 'left' then 'joined' else p.status end
  where p.id = (select id from mine) returning p.id, p.seat
),
seated as (
  insert into participants (lobby_id, token_hash, name, seat, status)
  select l.id, $2, $3, f.seat, 'joined'
  from l, free_seat f
  where (select id from mine) is null and l.phase = 'lobby'
  returning id, seat
),
joined as (select * from rejoined union all select * from seated),
bump as (
  update lobbies lob set version = lob.version + 1, updated_at = now()
  from joined j where lob.id = (select id from l) returning lob.id
),
log as (
  insert into events (lobby_id, participant_id, kind, payload)
  select (select id from l), s.id, 'joined',
    jsonb_build_object('seat', s.seat, 'name', $3::text, 'detail', 'joined the lobby')
  from seated s
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select id from mine) as existing_id,
  (select seat from free_seat) as free_seat,
  (select count(*)::int from seated) as seated
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
        existing_id: string | null;
        free_seat: number | null;
        seated: number;
      }>(JOIN_SQL, [input.code, tokenHash, name, CAPACITY]);
      const row = rows[0];
      if (!row?.lobby_id) {
        return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
      }
      if (row.existing_id === null && row.seated === 0) {
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
      return { ok: false, status: 503, error: serverError(error) };
    }
  }
  return { ok: false, status: 503, error: { error: 'Could not take a seat.', reason: 'server' } };
}

const START_SQL = `
with l as (select id, phase, host_participant from lobbies where code = $1 for update),
me as (select p.id, p.seat, p.name from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'),
players as (select count(*)::int as n from participants p where p.lobby_id = (select id from l) and p.status <> 'left'),
started as (
  update lobbies lob set phase = 'draw', settings = $3::jsonb, mode = $4, era = $5,
    version = lob.version + 1, updated_at = now()
  from l, me, players
  where lob.id = l.id and l.phase = 'lobby' and l.host_participant = me.id and players.n >= 2
  returning lob.id
),
log as (
  insert into events (lobby_id, participant_id, kind, payload)
  select (select id from l), (select id from me), 'started',
    jsonb_build_object('seat', (select seat from me), 'name', (select name from me), 'detail', $6::text)
  from started
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select host_participant from l) as host,
  (select id from me) as me_id,
  (select n from players) as players,
  (select count(*)::int from started) as started
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
      players: number;
      started: number;
    }>(START_SQL, [
      input.code,
      tokenHash,
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
    if (row.started === 0 && row.phase === 'lobby' && row.host !== row.me_id) {
      return { ok: false, status: 403, error: { error: 'Only the host can start the league.', reason: 'forbidden' } };
    }
    if (row.started === 0 && row.phase === 'lobby' && row.players < 2) {
      return { ok: false, status: 409, error: { error: 'A league needs at least 2 players.', reason: 'conflict' } };
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

const DRAW_SQL = `
with l as (select id, phase from lobbies where code = $1 for update),
me as (select p.id, p.seat, p.name from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'),
existing as (select team from lobby_teams where lobby_id = (select id from l) and participant_id = (select id from me)),
taken as (select team from lobby_teams where lobby_id = (select id from l)),
pick as (
  select team from unnest($3::text[]) as candidate(team)
  where not exists (select 1 from taken t where t.team = candidate.team)
  order by random() limit 1
),
inserted as (
  insert into lobby_teams (lobby_id, participant_id, team)
  select (select id from l), (select id from me), (select team from pick)
  where (select id from me) is not null and (select phase from l) = 'draw'
    and not exists (select 1 from existing)
  on conflict do nothing
  returning team
),
bump as (
  update lobbies set version = version + 1, updated_at = now()
  where id = (select id from l) and exists (select 1 from inserted) returning id
),
log as (
  insert into events (lobby_id, participant_id, kind, payload)
  select (select id from l), (select id from me), 'draw',
    jsonb_build_object('seat', (select seat from me), 'name', (select name from me), 'detail', 'drew the ' || (select team from inserted))
  from inserted
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select id from me) as me_id,
  (select team from existing) as existing_team,
  (select team from pick) as pick,
  (select count(*)::int from inserted) as inserted
`;

export async function drawTeam(input: { code: string; secret: string; actionId: string }): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  await recordAction(input.code, tokenHash, input.actionId);
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const rows = await sql.query<{
        lobby_id: string | null;
        phase: LobbyPhase | null;
        me_id: string | null;
        existing_team: string | null;
        pick: string | null;
        inserted: number;
      }>(DRAW_SQL, [input.code, tokenHash, LEAGUE_TEAMS]);
      const row = rows[0];
      if (!row?.lobby_id) {
        return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
      }
      if (!row.me_id) {
        return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
      }
      if (row.existing_team) return readLobby({ code: input.code, secret: input.secret });
      if (row.phase !== 'draw') {
        return { ok: false, status: 409, error: { error: 'The team draw is closed.', reason: 'conflict' } };
      }
      if (!row.pick) {
        return { ok: false, status: 409, error: { error: 'Every team is claimed.', reason: 'conflict' } };
      }
      if (row.inserted > 0) return readLobby({ code: input.code, secret: input.secret });
    } catch (error) {
      if (!isUniqueViolation(error)) return { ok: false, status: 503, error: serverError(error) };
    }
  }
  return { ok: false, status: 503, error: { error: 'Could not draw a team.', reason: 'server' } };
}

const REROLL_SQL = `
with l as (select id, phase from lobbies where code = $1 for update),
me as (select p.id, p.seat, p.name from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'),
current as (select team, reroll_used from lobby_teams where lobby_id = (select id from l) and participant_id = (select id from me)),
taken as (select team from lobby_teams where lobby_id = (select id from l)),
pick as (
  select team from unnest($3::text[]) as candidate(team)
  where candidate.team <> (select team from current)
    and not exists (select 1 from taken t where t.team = candidate.team)
  order by random() limit 1
),
updated as (
  update lobby_teams set team = (select team from pick), reroll_used = true
  where lobby_id = (select id from l) and participant_id = (select id from me)
    and not reroll_used and team = (select team from current)
    and (select phase from l) = 'draw' and (select team from pick) is not null
  returning team
),
bump as (
  update lobbies set version = version + 1, updated_at = now()
  where id = (select id from l) and exists (select 1 from updated) returning id
),
log as (
  insert into events (lobby_id, participant_id, kind, payload)
  select (select id from l), (select id from me), 'reroll',
    jsonb_build_object('seat', (select seat from me), 'name', (select name from me), 'detail', 'rerolled to the ' || (select team from updated))
  from updated
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select id from me) as me_id,
  (select team from current) as current_team,
  (select reroll_used from current) as reroll_used,
  (select team from pick) as pick,
  (select count(*)::int from updated) as updated
`;

export async function rerollTeam(input: { code: string; secret: string; actionId: string }): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  await recordAction(input.code, tokenHash, input.actionId);
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const rows = await sql.query<{
        lobby_id: string | null;
        phase: LobbyPhase | null;
        me_id: string | null;
        current_team: string | null;
        reroll_used: boolean | null;
        pick: string | null;
        updated: number;
      }>(REROLL_SQL, [input.code, tokenHash, LEAGUE_TEAMS]);
      const row = rows[0];
      if (!row?.lobby_id) {
        return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
      }
      if (!row.me_id) {
        return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
      }
      if (!row.current_team) {
        return { ok: false, status: 409, error: { error: 'Draw a team first.', reason: 'conflict' } };
      }
      if (row.reroll_used) return readLobby({ code: input.code, secret: input.secret });
      if (row.phase !== 'draw') {
        return { ok: false, status: 409, error: { error: 'The team draw is closed.', reason: 'conflict' } };
      }
      if (!row.pick) {
        return { ok: false, status: 409, error: { error: 'Every team is claimed.', reason: 'conflict' } };
      }
      if (row.updated > 0) return readLobby({ code: input.code, secret: input.secret });
    } catch (error) {
      if (!isUniqueViolation(error)) return { ok: false, status: 503, error: serverError(error) };
    }
  }
  return { ok: false, status: 503, error: { error: 'Could not reroll a team.', reason: 'server' } };
}

const LOCK_SQL = `
with l as (select id, phase, host_participant from lobbies where code = $1 for update),
me as (select p.id from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'),
missing as (
  select id, row_number() over (order by seat) as rn from (
    select p.id, p.seat from participants p
    where p.lobby_id = (select id from l) and p.status <> 'left'
      and not exists (select 1 from lobby_teams t where t.lobby_id = p.lobby_id and t.participant_id = p.id)
    for update
  ) locked
),
free as (
  select team, row_number() over (order by random()) as rn
  from unnest($3::text[]) as candidate(team)
  where not exists (select 1 from lobby_teams t where t.lobby_id = (select id from l) and t.team = candidate.team)
),
assigned as (
  insert into lobby_teams (lobby_id, participant_id, team)
  select (select id from l), m.id, f.team
  from missing m join free f on f.rn = m.rn
  where (select phase from l) = 'draw' and (select host_participant from l) = (select id from me)
  on conflict do nothing
  returning participant_id
),
locked as (
  update lobbies set phase = 'building', locked_at = coalesce(locked_at, now()),
    version = version + 1, updated_at = now()
  where id = (select id from l) and phase = 'draw' and host_participant = (select id from me)
    and (select count(*) from participants p where p.lobby_id = (select id from l) and p.status <> 'left') >= 2
  returning id
),
log as (
  insert into events (lobby_id, kind, payload)
  select id, 'locked', jsonb_build_object('detail', 'locked the teams') from locked
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select host_participant from l) as host,
  (select id from me) as me_id,
  (select count(*)::int from assigned) as assigned,
  (select count(*)::int from locked) as locked
`;

export async function lockTeams(input: { code: string; secret: string; actionId: string }): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  await recordAction(input.code, tokenHash, input.actionId);
  try {
    const rows = await sql.query<{
      lobby_id: string | null;
      phase: LobbyPhase | null;
      host: string | null;
      me_id: string | null;
      assigned: number;
      locked: number;
    }>(LOCK_SQL, [input.code, tokenHash, LEAGUE_TEAMS]);
    const row = rows[0];
    if (!row?.lobby_id) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!row.me_id) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    if (row.host !== row.me_id) {
      return { ok: false, status: 403, error: { error: 'Only the host can lock the teams.', reason: 'forbidden' } };
    }
    if (row.locked === 0 && row.phase !== 'building') {
      return { ok: false, status: 409, error: { error: 'The team draw is closed.', reason: 'conflict' } };
    }
    return readLobby({ code: input.code, secret: input.secret });
  } catch (error) {
    return { ok: false, status: 503, error: serverError(error) };
  }
}

const BUILD_SQL = `
with l as (select id, phase from lobbies where code = $1 for update),
me as (select p.id from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'),
written as (
  update participants p set build = $3::jsonb, build_kind = $4, build_summary = $5::jsonb,
    status = 'ready', last_seen = now()
  where p.id = (select id from me) and p.build is null and (select phase from l) = 'building'
  returning p.id
),
bump as (
  update lobbies set version = version + 1, updated_at = now()
  where id = (select id from l) and exists (select 1 from written) returning id
),
log as (
  insert into events (lobby_id, participant_id, kind, payload)
  select (select id from l), (select id from me), 'submitted', jsonb_build_object('detail', 'submitted a build')
  from written
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select id from me) as me_id,
  (select count(*)::int from written) as written
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
      salary_powers: unknown;
    }>(
      `select l.id, l.phase, l.mode, l.era, l.season_secret, t.team, p.id as me_id,
         (p.build is not null) as has_build, p.salary_powers
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
    const powers = parsePowers(row.salary_powers);
    const checked = validateBuild(input.build, settings, data, row.team, row.season_secret, {
      buildSeed: buildSeedFor(row.season_secret, row.me_id),
      salaryGrid: powers.grid ?? undefined,
    });
    if (!checked.ok) return { ok: false, status: 400, error: { error: checked.error, reason: 'invalid' } };
    const result = await sql.query<{
      lobby_id: string | null;
      phase: LobbyPhase | null;
      me_id: string | null;
      written: number;
    }>(BUILD_SQL, [
      input.code,
      tokenHash,
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
    if (written.written === 0 && written.phase !== 'building') {
      return { ok: false, status: 409, error: { error: 'The build window is closed.', reason: 'conflict' } };
    }
    return readLobby({ code: input.code, secret: input.secret });
  } catch (error) {
    return { ok: false, status: 503, error: serverError(error) };
  }
}

const READY_SQL = `
with l as (select id, phase, stage from lobbies where code = $1 for update),
me as (select p.id from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'),
marked as (
  update participants p set
    preview_ready = case when (select phase from l) in ('preview', 'rematch') then true else p.preview_ready end,
    ready_stage = case
      when (select phase from l) in ('season', 'awards', 'playin', 'playoffs') and (select stage from l) = $3 then $3
      else p.ready_stage
    end,
    last_seen = now()
  where p.id = (select id from me)
  returning p.id
),
bump as (
  update lobbies set version = version + 1, updated_at = now()
  where id = (select id from l) and exists (select 1 from marked) returning id
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select stage from l) as stage,
  (select id from me) as me_id,
  (select count(*)::int from marked) as marked
`;

export async function readyLobby(input: { code: string; secret: string; actionId: string; stage: number }): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  await recordAction(input.code, tokenHash, input.actionId);
  try {
    const rows = await sql.query<{
      lobby_id: string | null;
      phase: LobbyPhase | null;
      stage: number | string | null;
      me_id: string | null;
      marked: number;
    }>(READY_SQL, [input.code, tokenHash, input.stage]);
    const row = rows[0];
    if (!row?.lobby_id) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!row.me_id) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    return readLobby({ code: input.code, secret: input.secret });
  } catch (error) {
    return { ok: false, status: 503, error: serverError(error) };
  }
}

const ADVANCE_SQL = `
with l as (
  select id, phase, stage, stage_cursor, stage_started_at, host_participant
  from lobbies where code = $1 for update
),
me as (select p.id from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'),
present as (
  select count(*)::int as n from participants p
  where p.lobby_id = (select id from l) and p.status <> 'left'
    and p.last_seen > now() - make_interval(secs => $5::int)
),
ready as (
  select count(*)::int as n from participants p
  where p.lobby_id = (select id from l) and p.status <> 'left'
    and p.last_seen > now() - make_interval(secs => $5::int)
    and p.ready_stage >= $3
),
advanced as (
  update lobbies lob set stage = $3 + 1, stage_cursor = 0, stage_started_at = now(),
    phase = $4, version = lob.version + 1, updated_at = now()
  from l, me
  where lob.id = l.id and l.stage = $3 and l.phase in ('season', 'awards', 'playin', 'playoffs')
    and me.id is not null
    and (l.host_participant = me.id or (select n from ready) = (select n from present))
  returning lob.id
),
log as (
  insert into events (lobby_id, kind, payload)
  select id, 'checkpoint', jsonb_build_object('detail', 'checkpoint ' || ($3 + 1)::text) from advanced
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select stage from l) as stage,
  (select id from me) as me_id,
  (select n from present) as present,
  (select n from ready) as ready,
  (select count(*)::int from advanced) as advanced
`;

const PREVIEW_START_SQL = `
with l as (select id, phase, host_participant from lobbies where code = $1 for update),
me as (select p.id from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left')
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select host_participant from l) as host,
  (select id from me) as me_id
`;

const REMATCH_SQL = `
with l as (select id, phase, host_participant from lobbies where code = $1 for update),
me as (select p.id from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'),
ok as (select 1 from l, me where l.host_participant = me.id and l.phase = 'recap'),
reset_p as (
  update participants p set build = null, build_kind = null, squad = null, build_summary = null,
    status = 'joined', ready_stage = -1, preview_ready = false, salary_powers = null, last_seen = now()
  where p.lobby_id = (select id from l) and p.status <> 'left' and exists (select 1 from ok)
  returning p.id
),
del_t as (delete from lobby_teams where lobby_id = (select id from l) and exists (select 1 from ok)),
reset_l as (
  update lobbies set phase = 'rematch', league = null, stage = 0, stage_cursor = 0,
    stage_started_at = null, locked_at = null, rematch = rematch + 1,
    season_secret = gen_random_uuid()::text, version = version + 1, updated_at = now()
  where id = (select id from l) and phase = 'recap' and exists (select 1 from ok)
  returning id
),
log as (
  insert into events (lobby_id, kind, payload)
  select id, 'rematch', jsonb_build_object('detail', 'started a rematch') from reset_l
)
select
  (select id from l) as lobby_id,
  (select phase from l) as phase,
  (select host_participant from l) as host,
  (select id from me) as me_id,
  (select count(*)::int from reset_l) as reset
`;

export async function advanceLobby(input: { code: string; secret: string; actionId: string; stage: number }): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  await recordAction(input.code, tokenHash, input.actionId);
  try {
    const context = await sql.query<{
      id: string;
      phase: LobbyPhase;
      stage: number | string;
      stage_cursor: number | string;
      stage_started_at: string | null;
      host_participant: string | null;
      season_secret: string;
      mode: string;
      era: string;
      league: unknown;
    }>(
      `select id, phase, stage, stage_cursor, stage_started_at, host_participant, season_secret, mode, era, league
       from lobbies where code = $1`,
      [input.code],
    );
    const lobby = context[0];
    if (!lobby) return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    if (lobby.phase === 'draw') return readLobby({ code: input.code, secret: input.secret });
    if (lobby.phase === 'preview') {
      const rows = await sql.query<{ lobby_id: string | null; phase: LobbyPhase | null; host: string | null; me_id: string | null }>(
        PREVIEW_START_SQL,
        [input.code, tokenHash],
      );
      const row = rows[0];
      if (!row?.lobby_id) {
        return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
      }
      if (!row.me_id) {
        return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
      }
      if (row.host !== row.me_id) {
        return { ok: false, status: 403, error: { error: 'Only the host can start the season.', reason: 'forbidden' } };
      }
      await computeLeagueFor(row.lobby_id);
      return readLobby({ code: input.code, secret: input.secret });
    }
    if (lobby.phase === 'building') {
      const data = await catalog();
      const hostRows = await sql.query<{
        lobby_id: string | null;
        phase: LobbyPhase | null;
        host: string | null;
        me_id: string | null;
      }>(
        PREVIEW_START_SQL,
        [input.code, tokenHash],
      );
      const hostRow = hostRows[0];
      if (!hostRow?.lobby_id) {
        return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
      }
      if (!hostRow.me_id) {
        return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
      }
      if (hostRow.host !== hostRow.me_id) {
        return { ok: false, status: 403, error: { error: 'Only the host can lock the builds.', reason: 'forbidden' } };
      }
      await autoCompleteMissing(lobby, data);
      const updated = await sql.query<{ id: string }>(
        `update lobbies set phase = 'preview', version = version + 1, updated_at = now()
         where id = $1::uuid and phase = 'building' returning id`,
        [lobby.id],
      );
      if (updated[0]) {
        await sql.query(
          `insert into events (lobby_id, kind, payload)
           values ($1::uuid, 'preview', jsonb_build_object('detail', 'locked the builds'))`,
          [lobby.id],
        );
      }
      return readLobby({ code: input.code, secret: input.secret });
    }
    if (lobby.phase === 'rematch') {
      const hostRows = await sql.query<{
        lobby_id: string | null;
        phase: LobbyPhase | null;
        host: string | null;
        me_id: string | null;
      }>(
        PREVIEW_START_SQL,
        [input.code, tokenHash],
      );
      const hostRow = hostRows[0];
      if (!hostRow?.lobby_id) {
        return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
      }
      if (!hostRow.me_id) {
        return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
      }
      if (hostRow.host !== hostRow.me_id) {
        return { ok: false, status: 403, error: { error: 'Only the host can open the draw.', reason: 'forbidden' } };
      }
      if (hostRow.phase !== 'rematch') {
        return readLobby({ code: input.code, secret: input.secret });
      }
      const updated = await sql.query<{ id: string }>(REMATCH_DRAW_SQL, [hostRow.lobby_id]);
      if (!updated[0]) {
        const retained = await sql.query<{ n: number }>(
          "select count(*)::int as n from participants where lobby_id = $1::uuid and status <> 'left'",
          [hostRow.lobby_id],
        );
        if ((retained[0]?.n ?? 0) < 2) {
          return { ok: false, status: 409, error: { error: 'A league needs at least 2 players.', reason: 'conflict' } };
        }
        const unready = await sql.query<{ n: number }>(
          "select count(*)::int as n from participants where lobby_id = $1::uuid and status <> 'left' and not preview_ready",
          [hostRow.lobby_id],
        );
        const waiting = unready[0]?.n ?? 0;
        return {
          ok: false,
          status: 409,
          error: { error: `Waiting on ${waiting} player${waiting === 1 ? '' : 's'}.`, reason: 'conflict' },
        };
      }
      await sql.query(
        `insert into events (lobby_id, kind, payload)
         values ($1::uuid, 'draw', jsonb_build_object('detail', 'opened the team draw'))`,
        [hostRow.lobby_id],
      );
      return readLobby({ code: input.code, secret: input.secret });
    }
    if (
      lobby.phase !== 'season' &&
      lobby.phase !== 'awards' &&
      lobby.phase !== 'playin' &&
      lobby.phase !== 'playoffs'
    ) {
      return { ok: false, status: 409, error: { error: 'This league is not at a checkpoint.', reason: 'conflict' } };
    }
    if (input.stage !== Number(lobby.stage)) return readLobby({ code: input.code, secret: input.secret });
    const parsed = parseLeague(lobby.league);
    if (!parsed) return { ok: false, status: 409, error: { error: 'The season has not started.', reason: 'conflict' } };
    const stage = Number(lobby.stage);
    const cursor = Math.max(
      Number(lobby.stage_cursor),
      stageCursorAt(parsed, stage, lobby.stage_started_at ? Date.parse(lobby.stage_started_at) : null, Date.now()),
    );
    if (!isCheckpoint(cursor, stageGamesTotal(parsed, stage))) {
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
    }>(ADVANCE_SQL, [input.code, tokenHash, stage, NEXT_PHASE[next] ?? 'recap', Math.floor(AWAY_MS / 1000)]);
    const row = rows[0];
    if (!row?.lobby_id) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!row.me_id) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    if (row.advanced > 0) return readLobby({ code: input.code, secret: input.secret });
    if (Number(row.stage) !== stage) return readLobby({ code: input.code, secret: input.secret });
    const waiting = Math.max(0, row.present - row.ready);
    return {
      ok: false,
      status: 409,
      error: { error: `Waiting on ${waiting} player${waiting === 1 ? '' : 's'}.`, reason: 'conflict' },
    };
  } catch (error) {
    return { ok: false, status: 503, error: serverError(error) };
  }
}

export async function rematchLobby(input: { code: string; secret: string; actionId: string }): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  await recordAction(input.code, tokenHash, input.actionId);
  try {
    const rows = await sql.query<{
      lobby_id: string | null;
      phase: LobbyPhase | null;
      host: string | null;
      me_id: string | null;
      reset: number;
    }>(REMATCH_SQL, [input.code, tokenHash]);
    const row = rows[0];
    if (!row?.lobby_id) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!row.me_id) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    if (row.host !== row.me_id) {
      return { ok: false, status: 403, error: { error: 'Only the host can start a rematch.', reason: 'forbidden' } };
    }
    if (row.reset === 0 && row.phase !== 'rematch') {
      return { ok: false, status: 409, error: { error: 'This league is not finished.', reason: 'conflict' } };
    }
    return readLobby({ code: input.code, secret: input.secret });
  } catch (error) {
    return { ok: false, status: 503, error: serverError(error) };
  }
}

const LEAVE_SQL = `
with l as (select id, phase from lobbies where code = $1 for update),
me as (select p.id, p.seat, p.name, p.status from participants p where p.lobby_id = (select id from l) and p.token_hash = $2),
removed as (
  delete from participants p
  where p.id = (select id from me) and (select phase from l) in ('lobby', 'draw')
  returning p.id, p.seat, p.name
),
marked as (
  update participants p set status = 'left', last_seen = now()
  where p.id = (select id from me) and (select phase from l) not in ('lobby', 'draw') and p.status <> 'left'
  returning p.id, p.seat, p.name
),
gone as (select * from removed union all select * from marked),
bump as (
  update lobbies set version = version + 1, updated_at = now()
  where id = (select id from l) and exists (select 1 from gone) returning id
),
log as (
  insert into events (lobby_id, participant_id, kind, payload)
  select (select id from l), g.id, 'left', jsonb_build_object('seat', g.seat, 'name', g.name, 'detail', 'left the lobby')
  from gone g
)
select
  (select id from l) as lobby_id,
  (select id from me) as me_id,
  (select count(*)::int from gone) as left_count
`;

export async function leaveLobby(input: { code: string; secret: string; actionId: string }): Promise<LeaveOutcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  await recordAction(input.code, tokenHash, input.actionId);
  try {
    const rows = await sql.query<{ lobby_id: string | null; me_id: string | null; left_count: number }>(LEAVE_SQL, [
      input.code,
      tokenHash,
    ]);
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

const REMOVE_SQL = `
with l as (select id, phase, host_participant from lobbies where code = $1 for update),
me as (select p.id from participants p where p.lobby_id = (select id from l) and p.token_hash = $2 and p.status <> 'left'),
target as (
  select p.id, p.seat, p.name, p.status, p.last_seen from participants p
  where p.lobby_id = (select id from l) and p.seat = $3
  for update
),
removed as (
  delete from participants p
  where p.id = (select id from target) and (select phase from l) in ('lobby', 'draw')
    and (select host_participant from l) = (select id from me)
    and (select last_seen from target) < now() - make_interval(secs => $4::int)
  returning p.id, p.seat, p.name
),
marked as (
  update participants p set status = 'left', last_seen = now()
  where p.id = (select id from target) and (select phase from l) not in ('lobby', 'draw')
    and (select host_participant from l) = (select id from me)
    and (select last_seen from target) < now() - make_interval(secs => $4::int)
    and p.status <> 'left'
  returning p.id, p.seat, p.name
),
gone as (select * from removed union all select * from marked),
bump as (
  update lobbies set version = version + 1, updated_at = now()
  where id = (select id from l) and exists (select 1 from gone) returning id
),
log as (
  insert into events (lobby_id, participant_id, kind, payload)
  select (select id from l), g.id, 'removed', jsonb_build_object('seat', g.seat, 'name', g.name, 'detail', 'was removed while away')
  from gone g
)
select
  (select id from l) as lobby_id,
  (select host_participant from l) as host,
  (select id from me) as me_id,
  (select id from target) as target_id,
  (select status from target) as target_status,
  (select last_seen from target) as target_seen,
  (select count(*)::int from gone) as removed
`;

export async function removePlayer(input: {
  code: string;
  secret: string;
  actionId: string;
  seat: number;
}): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  await recordAction(input.code, tokenHash, input.actionId);
  try {
    const rows = await sql.query<{
      lobby_id: string | null;
      host: string | null;
      me_id: string | null;
      target_id: string | null;
      target_status: ParticipantStatus | null;
      target_seen: string | null;
      removed: number;
    }>(REMOVE_SQL, [input.code, tokenHash, input.seat, Math.floor(AWAY_MS / 1000)]);
    const row = rows[0];
    if (!row?.lobby_id) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!row.me_id) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    if (row.host !== row.me_id) {
      return { ok: false, status: 403, error: { error: 'Only the host can remove a player.', reason: 'forbidden' } };
    }
    if (!row.target_id) {
      return { ok: false, status: 404, error: { error: 'That seat is empty.', reason: 'not_found' } };
    }
    if (row.target_id === row.me_id) {
      return { ok: false, status: 400, error: { error: 'The host cannot remove themselves.', reason: 'invalid' } };
    }
    if (row.target_status === 'left') return readLobby({ code: input.code, secret: input.secret });
    if (row.removed === 0) {
      return { ok: false, status: 409, error: { error: 'That player is still here.', reason: 'conflict' } };
    }
    return readLobby({ code: input.code, secret: input.secret });
  } catch (error) {
    return { ok: false, status: 503, error: serverError(error) };
  }
}

const POWER_CONTEXT_SQL = `
select l.id as lobby_id, l.phase, l.mode, l.season_secret, p.id as me_id, p.status, p.salary_powers
from lobbies l
left join participants p on p.lobby_id = l.id and p.token_hash = $2 and p.status <> 'left'
where l.code = $1
`;

const POWER_WRITE_SQL = `
with updated as (
  update participants p set salary_powers = $3::jsonb, last_seen = now()
  where p.id = $1::uuid and p.salary_powers is not distinct from $2::jsonb
    and exists (select 1 from lobbies l where l.id = p.lobby_id and l.phase = 'building' and l.mode = 'salary')
  returning p.id, p.lobby_id
),
bump as (
  update lobbies set version = version + 1, updated_at = now()
  where id = (select lobby_id from updated) returning id
),
log as (
  insert into events (lobby_id, participant_id, kind, payload)
  select lobby_id, id, 'power', jsonb_build_object('detail', $4::text) from updated
)
select (select count(*)::int from updated) as updated
`;

export async function powerLobby(input: {
  code: string;
  secret: string;
  actionId: string;
  power: 'shuffle' | 'scout';
  target: ShuffleTarget | { cardId: string };
}): Promise<Outcome> {
  const sql = db();
  const tokenHash = await hashSecret(input.secret);
  await recordAction(input.code, tokenHash, input.actionId);
  try {
    const data = await catalog();
    const rows = await sql.query<{
      lobby_id: string | null;
      phase: LobbyPhase | null;
      mode: string | null;
      season_secret: string | null;
      me_id: string | null;
      status: ParticipantStatus | null;
      salary_powers: unknown;
    }>(POWER_CONTEXT_SQL, [input.code, tokenHash]);
    const row = rows[0];
    if (!row?.lobby_id) {
      return { ok: false, status: 404, error: { error: 'No lobby found for that code.', reason: 'not_found' } };
    }
    if (!row.me_id) {
      return { ok: false, status: 403, error: { error: 'You are not in this lobby.', reason: 'forbidden' } };
    }
    if (row.phase !== 'building' || row.mode !== 'salary' || row.status === 'ready') {
      return { ok: false, status: 409, error: { error: 'Salary powers are closed.', reason: 'conflict' } };
    }
    const secret = row.season_secret ?? '';
    const base = salaryBoardFor(secret, data);
    const powers = parsePowers(row.salary_powers);
    let next: SalaryPowersState;
    if (input.power === 'shuffle') {
      if (powers.shuffle) return readLobby({ code: input.code, secret: input.secret });
      const target = input.target as ShuffleTarget;
      const grid = powers.grid ?? base.grid;
      const rng = seededRng(`${secret}:power:${row.me_id}:shuffle`);
      const nextGrid = target.kind === 'column' ? shuffleColumn(grid, target.index, rng) : shuffleRow(grid, target.tier, rng);
      const oldIds = new Map<string, string>();
      for (const column of grid) for (const card of column) oldIds.set(card.name, card.id);
      const nextScouted: Record<string, string> = {};
      for (const column of nextGrid) {
        for (const card of column) {
          const oldId = oldIds.get(card.name);
          if (oldId && powers.scouted[oldId]) nextScouted[card.id] = scoutGrade(card);
        }
      }
      next = { shuffle: true, scout: powers.scout, grid: nextGrid, scouted: nextScouted };
    } else {
      if (powers.scout) return readLobby({ code: input.code, secret: input.secret });
      const target = input.target as { cardId: string };
      const grid = powers.grid ?? base.grid;
      const card = grid.flat().find((entry) => entry.id === target.cardId);
      if (!card) {
        return { ok: false, status: 400, error: { error: 'That card is not on your board.', reason: 'invalid' } };
      }
      next = { shuffle: powers.shuffle, scout: true, grid: powers.grid, scouted: { ...powers.scouted, [card.id]: scoutGrade(card) } };
    }
    const previous = row.salary_powers === null || row.salary_powers === undefined ? null : JSON.stringify(row.salary_powers);
    const written = await sql.query<{ updated: number }>(POWER_WRITE_SQL, [
      row.me_id,
      previous,
      JSON.stringify(next),
      input.power === 'shuffle' ? 'used a shuffle' : 'used a scout',
    ]);
    if ((written[0]?.updated ?? 0) === 0) return readLobby({ code: input.code, secret: input.secret });
    return readLobby({ code: input.code, secret: input.secret });
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
  const data = await catalog();
  await autoCompleteMissing(lobby, data);
  const rows = await sql.query<LeagueParticipantRow>(
    `select p.id, p.name, p.seat, p.build, t.team
     from participants p join lobby_teams t on t.lobby_id = p.lobby_id and t.participant_id = p.id
     where p.lobby_id = $1::uuid and p.status <> 'left' order by p.seat`,
    [lobbyId],
  );
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
  await sql.query(
    `update lobbies set phase = 'season', stage = 0, stage_cursor = 0, stage_started_at = now(),
       league = $2::jsonb, locked_at = coalesce(locked_at, now()), version = version + 1, updated_at = now()
     where id = $1::uuid and league is null and phase = 'preview'`,
    [lobbyId, JSON.stringify(league)],
  );
}
