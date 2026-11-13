import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as createHandler } from '../api/lobby/index';
import { GET as viewHandler } from '../api/lobby/[code]/index';
import { POST as joinHandler } from '../api/lobby/[code]/join';
import { POST as startHandler } from '../api/lobby/[code]/start';
import { POST as buildHandler } from '../api/lobby/[code]/build';
import { POST as submitHandler } from '../api/lobby/[code]/submit';
import { POST as releaseHandler } from '../api/lobby/[code]/release';
import { POST as leaveHandler } from '../api/lobby/[code]/leave';
import { loadLocalEnv } from '../scripts/lib.ts';
import { db } from '../src/server/db';
import { loadCatalog, poolFor } from '../src/shared/data/loader';
import { BIG_ATTRS, GUARD_ATTRS } from '../src/shared/engine/rules';
import { seededRng } from '../src/shared/engine/rng';
import { simulateSeason } from '../src/shared/engine/season';
import type { Build, Era, Pick, Position, SeasonResult } from '../src/shared/engine/types';
import { generateSecret, newActionId } from '../src/shared/mp/codes';
import { progressToken } from '../src/shared/mp/progress';
import type { BuildDraft, LobbyDelta, LobbySettings, LobbyView } from '../src/shared/mp/types';

const BASE = 'http://localhost:4173/api';
const SETTINGS: LobbySettings = { era: 'current', positions: ['guard', 'big'], revealSeconds: 2 };
const HOLD_WAIT = 3400;
const created: string[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(() => {
  loadLocalEnv();
  expect(process.env.DATABASE_URL, 'DATABASE_URL must be available for the lobby tests').toBeTruthy();
});

afterAll(async () => {
  if (!created.length) return;
  await db().query('delete from lobbies where code = any($1::text[])', [created]);
  const rows = await db().query<{ count: string }>(
    'select count(*)::text as count from lobbies where code = any($1::text[])',
    [created],
  );
  expect(rows[0]?.count).toBe('0');
});

function authed(secret: string, path: string, body: unknown): Request {
  return new Request(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
}

function poll(secret: string, code: string, since?: number, token?: string, events?: number): Request {
  const query = new URLSearchParams();
  if (since !== undefined) query.set('since', String(since));
  if (token !== undefined) query.set('token', token);
  if (events !== undefined) query.set('events', String(events));
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`;
  return new Request(`${BASE}/lobby/${code}${suffix}`, { headers: { authorization: `Bearer ${secret}` } });
}

async function read<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface Seat {
  secret: string;
  seat: number;
}

async function newLobby(name: string): Promise<{ code: string; host: Seat; view: LobbyView }> {
  const secret = generateSecret();
  const response = await createHandler(authed(secret, 'lobby', { name, actionId: newActionId() }));
  expect(response.status).toBe(201);
  const body = await read<{ lobby: LobbyView; code: string; seat: number }>(response);
  created.push(body.code);
  return { code: body.code, host: { secret, seat: body.seat }, view: body.lobby };
}

async function join(code: string, name: string, secret = generateSecret()): Promise<{ response: Response; seat: Seat }> {
  const response = await joinHandler(authed(secret, `lobby/${code}/join`, { name, actionId: newActionId() }));
  return { response, seat: { secret, seat: -1 } };
}

async function start(code: string, secret: string): Promise<Response> {
  return startHandler(authed(secret, `lobby/${code}/start`, { actionId: newActionId(), settings: SETTINGS }));
}

async function submit(code: string, secret: string, draft: BuildDraft, actionId = newActionId()): Promise<Response> {
  return submitHandler(authed(secret, `lobby/${code}/submit`, { actionId, draft }));
}

async function release(code: string, secret: string, force = false): Promise<Response> {
  return releaseHandler(authed(secret, `lobby/${code}/release`, { actionId: newActionId(), force }));
}

async function view(code: string, secret: string, since?: number): Promise<LobbyView> {
  const response = await viewHandler(poll(secret, code, since));
  expect(response.status).toBe(200);
  return (await read<{ lobby: LobbyView }>(response)).lobby;
}

async function seatsOf(code: string): Promise<Array<{ seat: number; secret: string }>> {
  const list: Array<{ seat: number; secret: string }> = [];
  for (let index = 0; index < 8; index++) {
    const candidate = generateSecret();
    const response = await joinHandler(authed(candidate, `lobby/${code}/join`, { name: `Probe${index}`, actionId: newActionId() }));
    if (response.status !== 200) continue;
    const body = await read<{ lobby: LobbyView }>(response);
    list.push({ seat: body.lobby.me.seat, secret: candidate });
  }
  return list;
}

async function draftFor(position: Position, era: Era, strength: 'high' | 'low'): Promise<BuildDraft> {
  const catalog = await loadCatalog();
  const pool = poolFor(catalog, position, era);
  const keys: readonly string[] = position === 'guard' ? GUARD_ATTRS : BIG_ATTRS;
  const picks: Record<string, Pick> = {};
  for (const attr of keys) {
    const ranked = pool
      .filter((player) => player.attrs[attr] !== undefined)
      .sort((a, b) => (b.attrs[attr] ?? 0) - (a.attrs[attr] ?? 0));
    const player = strength === 'high' ? ranked[0] : ranked[ranked.length - 1];
    if (!player) throw new Error(`no ${era} ${position} player for ${attr}`);
    picks[attr] = {
      attr,
      val: player.attrs[attr] ?? 0,
      playerName: player.name,
      playerShort: player.short,
      team: player.team,
    };
  }
  return {
    position,
    era,
    picks,
    spinIndex: keys.length,
    teamRespinUsed: false,
    playerRespinUsed: false,
    current: null,
    team: strength === 'high' ? (era === 'current' ? 'OKC' : 'BOS') : 'BKN',
    latest: null,
  };
}

async function ageLastSeen(code: string, seat: number, minutes: number): Promise<void> {
  await db().query(
    'update participants set last_seen = now() - make_interval(mins => $3::int) where lobby_id = (select id from lobbies where code = $1) and seat = $2',
    [code, seat, minutes],
  );
}

async function eventCount(code: string, kind: string): Promise<number> {
  const rows = await db().query<{ count: string }>(
    'select count(*)::text as count from events e join lobbies l on l.id = e.lobby_id where l.code = $1 and e.kind = $2',
    [code, kind],
  );
  return Number(rows[0]?.count ?? '0');
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('lobby lifecycle', () => {
  it('creates a lobby, joins by code and rejects unknown codes', async () => {
    const lobby = await newLobby('Host');
    expect(lobby.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(lobby.view.phase).toBe('lobby');
    expect(lobby.view.participants).toHaveLength(1);
    expect(lobby.view.me.isHost).toBe(true);
    expect(lobby.view.events[0]?.kind).toBe('joined');

    const guest = await join(lobby.code.toLowerCase(), 'Guest');
    expect(guest.response.status).toBe(200);
    const guestSeat = (await read<{ lobby: LobbyView }>(guest.response)).lobby.me.seat;
    expect(guestSeat).toBe(2);

    const hostView = await view(lobby.code, lobby.host.secret);
    expect(hostView.participants.map((entry) => entry.seat)).toEqual([1, 2]);
    expect(hostView.participants[1]?.isHost).toBe(false);
    expect(hostView.seatsTaken).toBe(2);

    const missing = await join('ZZZZZZ', 'Nobody');
    expect(missing.response.status).toBe(404);
    expect((await read<{ error: string }>(missing.response)).error).toMatch(/no lobby/i);
  });

  it('seats exactly eight participants under concurrent joins', async () => {
    const lobby = await newLobby('Host');
    const attempts = await Promise.all(Array.from({ length: 12 }, (_, index) => join(lobby.code, `P${index}`)));
    const accepted = attempts.filter((entry) => entry.response.status === 200);
    const rejected = attempts.filter((entry) => entry.response.status === 409);
    expect(accepted).toHaveLength(7);
    expect(rejected).toHaveLength(5);
    for (const entry of rejected) {
      expect((await read<{ error: string }>(entry.response)).error).toMatch(/full/i);
    }
    const hostView = await view(lobby.code, lobby.host.secret);
    const seats = hostView.participants.map((entry) => entry.seat).sort((a, b) => a - b);
    expect(seats).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(seats).size).toBe(8);
    expect(hostView.seatsTaken).toBe(8);
  });

  it('rejects joins once the lobby has started', async () => {
    const lobby = await newLobby('Host');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    const late = await join(lobby.code, 'Late');
    expect(late.response.status).toBe(409);
    expect((await read<{ error: string }>(late.response)).error).toMatch(/already started/i);
  });

  it('rejects host only actions for other participants', async () => {
    const lobby = await newLobby('Host');
    const guest = await join(lobby.code, 'Guest');
    const response = await start(lobby.code, guest.seat.secret);
    expect(response.status).toBe(403);
    expect((await read<{ error: string }>(response)).error).toMatch(/host/i);
    expect((await view(lobby.code, lobby.host.secret)).phase).toBe('lobby');
  });

  it('replays the same action id without applying it twice', async () => {
    const lobby = await newLobby('Host');
    const startId = newActionId();
    const body = { actionId: startId, settings: SETTINGS };
    const first = await startHandler(authed(lobby.host.secret, `lobby/${lobby.code}/start`, body));
    expect(first.status).toBe(200);
    const firstVersion = (await read<{ lobby: LobbyView }>(first)).lobby.version;
    const second = await startHandler(authed(lobby.host.secret, `lobby/${lobby.code}/start`, body));
    expect(second.status).toBe(200);
    expect((await read<{ lobby: LobbyView }>(second)).lobby.version).toBe(firstVersion);

    const draft = await draftFor('guard', 'current', 'high');
    const submitId = newActionId();
    const one = await submit(lobby.code, lobby.host.secret, draft, submitId);
    expect(one.status).toBe(200);
    const oneLobby = (await read<{ lobby: LobbyView }>(one)).lobby;
    const two = await submit(lobby.code, lobby.host.secret, draft, submitId);
    expect(two.status).toBe(200);
    const twoLobby = (await read<{ lobby: LobbyView }>(two)).lobby;
    expect(twoLobby.version).toBe(oneLobby.version);
    expect(twoLobby.me.season?.wins).toBe(oneLobby.me.season?.wins);
    expect(twoLobby.me.season?.losses).toBe(oneLobby.me.season?.losses);
  });

  it('gives a participant one season and refuses a reroll', async () => {
    const lobby = await newLobby('Host');
    const guest = await join(lobby.code, 'Guest');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    const strong = await draftFor('guard', 'current', 'high');
    const actionId = newActionId();

    const first = await submit(lobby.code, lobby.host.secret, strong, actionId);
    expect(first.status).toBe(200);
    const stored = (await read<{ lobby: LobbyView }>(first)).lobby;
    expect(stored.me.season).not.toBeNull();
    const keptStatus = stored.me.status;
    expect(['qualified', 'eliminated']).toContain(keptStatus);

    const retry = await submit(lobby.code, lobby.host.secret, strong, actionId);
    expect(retry.status).toBe(200);
    const replayed = (await read<{ lobby: LobbyView }>(retry)).lobby;
    expect(replayed.version).toBe(stored.version);
    expect(replayed.me.season?.wins).toBe(stored.me.season?.wins);
    expect(replayed.me.status).toBe(keptStatus);

    const reroll = await submit(lobby.code, lobby.host.secret, await draftFor('guard', 'current', 'low'));
    expect(reroll.status).toBe(409);
    expect((await read<{ error: string }>(reroll)).error).toMatch(/season is already/i);

    const after = await view(lobby.code, lobby.host.secret);
    expect(after.version).toBe(stored.version);
    expect(after.me.season?.wins).toBe(stored.me.season?.wins);
    expect(after.me.season?.losses).toBe(stored.me.season?.losses);
    expect(after.me.status).toBe(keptStatus);
    expect(after.participants.find((entry) => entry.seat === 2)?.status).toBe('joined');
    expect(await eventCount(lobby.code, 'qualified') + (await eventCount(lobby.code, 'eliminated'))).toBe(1);

    expect((await submit(lobby.code, guest.seat.secret, await draftFor('big', 'current', 'low'))).status).toBe(200);
    await sleep(HOLD_WAIT);
    const released = await release(lobby.code, lobby.host.secret);
    expect(released.status).toBe(200);
    expect((await read<{ lobby: LobbyView }>(released)).lobby.phase).toBe('playoffs');

    const duringPlayoffs = await submit(lobby.code, lobby.host.secret, await draftFor('guard', 'current', 'high'));
    expect(duringPlayoffs.status).toBe(409);
    expect((await read<{ error: string }>(duringPlayoffs)).error).toMatch(/season is already|playoffs/i);
    const playoffView = await view(lobby.code, lobby.host.secret);
    expect(playoffView.phase).toBe('playoffs');
    expect(['playoffs', 'done']).toContain(playoffView.me.status);
    expect(playoffView.me.season?.wins).toBe(stored.me.season?.wins);
  });

  it('runs the season on a server seed instead of client inputs', async () => {
    const lobby = await newLobby('Host');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    const draft = await draftFor('guard', 'current', 'high');
    const actionId = newActionId();
    expect((await submit(lobby.code, lobby.host.secret, draft, actionId)).status).toBe(200);

    const rows = await db().query<{ season: SeasonResult; season_secret: string }>(
      `select p.season, l.season_secret from participants p join lobbies l on l.id = p.lobby_id
       where l.code = $1 and p.seat = 1`,
      [lobby.code],
    );
    const row = rows[0] as { season: SeasonResult; season_secret: string };
    expect(row.season_secret).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const other = await newLobby('Second');
    const otherSecrets = await db().query<{ season_secret: string }>('select season_secret from lobbies where code = $1', [
      other.code,
    ]);
    expect(otherSecrets[0]?.season_secret).not.toBe(row.season_secret);

    const build: Build = { position: draft.position, era: draft.era, picks: draft.picks };
    const team = draft.team as string;
    const serverSeed = `${row.season_secret}:${actionId}`;
    const fromServerSeed = simulateSeason({
      build,
      team,
      playerName: 'Host',
      rng: seededRng(serverSeed),
      displayRng: seededRng(`${serverSeed}:display`),
    });
    expect(row.season).toEqual(jsonClone(fromServerSeed));

    const clientSeed = `${lobby.code}:${draft.position}:${draft.picks.jumpShot?.playerName ?? 'x'}:${actionId}`;
    const fromClientSeed = simulateSeason({
      build,
      team,
      playerName: 'Host',
      rng: seededRng(clientSeed),
      displayRng: seededRng(`${clientSeed}:display`),
    });
    expect(row.season).not.toEqual(jsonClone(fromClientSeed));
  });

  it('resumes a seat and an unfinished draft after a reconnect', async () => {
    const lobby = await newLobby('Host');
    const guest = await join(lobby.code, 'Guest');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    const draft = await draftFor('guard', 'current', 'high');
    const partial: BuildDraft = {
      ...draft,
      picks: Object.fromEntries(Object.entries(draft.picks).slice(0, 4)),
      spinIndex: 4,
      latest: { attr: 'jumpShot', playerName: 'Stephen Curry' },
    };
    const synced = await buildHandler(
      authed(guest.seat.secret, `lobby/${lobby.code}/build`, { actionId: newActionId(), draft: partial }),
    );
    expect(synced.status).toBe(200);

    const reconnect = await joinHandler(
      authed(guest.seat.secret, `lobby/${lobby.code}/join`, { name: 'Guest', actionId: newActionId() }),
    );
    expect(reconnect.status).toBe(200);
    const resumed = (await read<{ lobby: LobbyView }>(reconnect)).lobby;
    expect(resumed.me.seat).toBe(2);
    expect(resumed.participants).toHaveLength(2);
    expect(Object.keys(resumed.me.build?.picks ?? {})).toHaveLength(4);
    expect(resumed.me.build?.spinIndex).toBe(4);
    expect(resumed.me.summary?.filled).toBe(4);
  });

  it('shows what the others are doing without leaking their draft', async () => {
    const lobby = await newLobby('Host');
    const guest = await join(lobby.code, 'Guest');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    const draft = await draftFor('guard', 'current', 'high');
    const partial: BuildDraft = {
      ...draft,
      picks: Object.fromEntries(Object.entries(draft.picks).slice(0, 3)),
      spinIndex: 3,
      latest: { attr: 'jumpShot', playerName: 'Stephen Curry' },
    };
    const synced = await buildHandler(
      authed(guest.seat.secret, `lobby/${lobby.code}/build`, { actionId: newActionId(), draft: partial }),
    );
    expect(synced.status).toBe(200);
    const hostView = await view(lobby.code, lobby.host.secret);
    const other = hostView.participants.find((entry) => entry.seat === 2);
    expect(other?.summary).toEqual({ filled: 3, total: 10, latest: 'Stephen Curry' });
    expect(other?.build).toBeNull();
    expect(other?.status).toBe('building');
    expect(hostView.me.build).toBeNull();
    const guestView = await view(lobby.code, guest.seat.secret);
    expect(Object.keys(guestView.me.build?.picks ?? {})).toHaveLength(3);
  });

  it('rejects a forged build', async () => {
    const lobby = await newLobby('Host');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    const draft = await draftFor('guard', 'current', 'high');
    const first = Object.keys(draft.picks)[0] as string;
    const forged: BuildDraft = {
      ...draft,
      picks: { ...draft.picks, [first]: { ...(draft.picks[first] as Pick), val: 99 } },
    };
    const response = await submit(lobby.code, lobby.host.secret, forged);
    expect(response.status).toBe(400);
    expect((await read<{ error: string }>(response)).error).toMatch(/does not match/i);

    const wrongEra = await submit(lobby.code, lobby.host.secret, { ...draft, era: 'alltime' });
    expect(wrongEra.status).toBe(400);
    expect((await read<{ error: string }>(wrongEra)).error).toMatch(/all-time players|current players/i);

    const incomplete = await submit(lobby.code, lobby.host.secret, {
      ...draft,
      picks: Object.fromEntries(Object.entries(draft.picks).slice(0, 9)),
    });
    expect(incomplete.status).toBe(400);
    expect((await view(lobby.code, lobby.host.secret)).me.season).toBeNull();
  });

  it('keeps the stored result when a late draft sync arrives', async () => {
    const lobby = await newLobby('Host');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    const draft = await draftFor('guard', 'current', 'high');
    const submitted = await submit(lobby.code, lobby.host.secret, draft);
    expect(submitted.status).toBe(200);
    const before = (await read<{ lobby: LobbyView }>(submitted)).lobby;
    expect(before.me.season?.wins).toBeTypeOf('number');

    const late = await buildHandler(
      authed(lobby.host.secret, `lobby/${lobby.code}/build`, { actionId: newActionId(), draft }),
    );
    expect(late.status).toBe(200);
    const after = (await read<{ lobby: LobbyView }>(late)).lobby;
    expect(after.me.season?.wins).toBe(before.me.season?.wins);
    expect(after.me.season?.qualified).toBe(before.me.season?.qualified);
    expect(after.me.status).toBe(before.me.status);
    expect(['season', 'barrier', 'playoffs']).toContain(after.phase);
  });

  it('holds the barrier until every present participant has a result, then releases once', async () => {
    const lobby = await newLobby('Host');
    const guest = await join(lobby.code, 'Guest');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    expect((await submit(lobby.code, lobby.host.secret, await draftFor('guard', 'current', 'high'))).status).toBe(200);

    const early = await release(lobby.code, lobby.host.secret);
    expect(early.status).toBe(409);
    expect((await read<{ error: string }>(early)).error).toMatch(/waiting on 1 player/i);

    const weak = await draftFor('big', 'current', 'low');
    expect((await submit(lobby.code, guest.seat.secret, weak)).status).toBe(200);

    const held = await Promise.all([release(lobby.code, lobby.host.secret), release(lobby.code, guest.seat.secret)]);
    for (const attempt of held) expect(attempt.status).toBe(200);
    const duringHold = await view(lobby.code, lobby.host.secret);
    expect(duringHold.phase).toBe('barrier');
    expect(duringHold.playoffsStartedAt).toBeNull();
    expect(await eventCount(lobby.code, 'playoffs_started')).toBe(0);

    await sleep(HOLD_WAIT);
    const attempts = await Promise.all([
      release(lobby.code, lobby.host.secret),
      release(lobby.code, guest.seat.secret),
    ]);
    for (const attempt of attempts) expect(attempt.status).toBeLessThan(500);
    expect(attempts.some((attempt) => attempt.status === 200)).toBe(true);

    const hostView = await view(lobby.code, lobby.host.secret);
    expect(hostView.phase).toBe('playoffs');
    expect(hostView.playoffsStartedAt).not.toBeNull();
    expect(await eventCount(lobby.code, 'playoffs_started')).toBe(1);

    const guestView = await view(lobby.code, guest.seat.secret);
    expect(guestView.playoffsStartedAt).toBe(hostView.playoffsStartedAt);
    const guestEntry = hostView.participants.find((entry) => entry.seat === 2);
    expect(guestEntry?.season?.qualified).toBe(false);
    expect(guestEntry?.status).toBe('done');
    expect(guestEntry?.rounds).toHaveLength(0);
  });

  it('does not let an absent participant hold the barrier', async () => {
    const lobby = await newLobby('Host');
    const guest = await join(lobby.code, 'Guest');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    expect((await submit(lobby.code, lobby.host.secret, await draftFor('guard', 'current', 'high'))).status).toBe(200);
    await ageLastSeen(lobby.code, 2, 5);

    await sleep(HOLD_WAIT);
    const response = await release(lobby.code, lobby.host.secret);
    expect(response.status).toBe(200);
    const released = (await read<{ lobby: LobbyView }>(response)).lobby;
    expect(released.phase).toBe('playoffs');
    const absent = released.participants.find((entry) => entry.seat === 2);
    expect(absent?.away).toBe(true);
    expect(absent?.status).toBe('joined');

    const lateDraft = await draftFor('guard', 'current', 'high');
    const late = await submit(lobby.code, guest.seat.secret, lateDraft);
    expect(late.status).toBe(409);
    expect((await read<{ error: string }>(late)).error).toMatch(/playoffs/i);
    const lateView = await view(lobby.code, guest.seat.secret);
    expect(lateView.phase).toBe('playoffs');
    expect(lateView.me.season).toBeNull();
  });

  it('hands the host role to the next present participant', async () => {
    const lobby = await newLobby('Host');
    const guest = await join(lobby.code, 'Guest');
    await ageLastSeen(lobby.code, 1, 5);
    const guestView = await view(lobby.code, guest.seat.secret);
    expect(guestView.hostSeat).toBe(2);
    expect(guestView.me.isHost).toBe(true);
    expect(guestView.participants.find((entry) => entry.seat === 1)?.away).toBe(true);
    expect(guestView.participants.find((entry) => entry.seat === 1)?.isHost).toBe(false);
    expect(await eventCount(lobby.code, 'host_changed')).toBeGreaterThanOrEqual(1);
    const started = await start(lobby.code, guest.seat.secret);
    expect(started.status).toBe(200);
    expect((await read<{ lobby: LobbyView }>(started)).lobby.phase).toBe('building');
  });

  it('reveals rounds on a shared clock and finishes the lobby', async () => {
    const lobby = await newLobby('Host');
    const guest = await join(lobby.code, 'Guest');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    expect((await submit(lobby.code, lobby.host.secret, await draftFor('guard', 'current', 'high'))).status).toBe(200);
    expect((await submit(lobby.code, guest.seat.secret, await draftFor('big', 'current', 'high'))).status).toBe(200);

    await sleep(HOLD_WAIT);
    const opened = await release(lobby.code, lobby.host.secret);
    expect(opened.status).toBe(200);
    const openedView = (await read<{ lobby: LobbyView }>(opened)).lobby;
    expect(openedView.phase).toBe('playoffs');
    expect(openedView.roundsRevealed).toBe(1);

    await db().query("update lobbies set playoffs_started_at = now() - interval '30 seconds' where code = $1", [lobby.code]);
    const finished = await view(lobby.code, lobby.host.secret);
    expect(finished.phase).toBe('finished');
    expect(finished.roundsRevealed).toBe(5);
    expect(finished.standings).not.toBeNull();
    const standings = finished.standings ?? [];
    expect(standings.length).toBe(2);
    for (const entry of standings) {
      expect(entry.record).toMatch(/^\d+-\d+$/);
      expect(typeof entry.finishLabel).toBe('string');
      expect((entry.finishLabel ?? '').length).toBeGreaterThan(2);
    }
    const rows = await db().query<{ seat: number; total: string; qualified: boolean }>(
      `select p.seat,
              coalesce(jsonb_array_length(p.season->'playoffRounds'), 0) as total,
              coalesce((p.season->>'madePlayoffs')::boolean, false) as qualified
       from participants p join lobbies l on l.id = p.lobby_id
       where l.code = $1 and p.status <> 'left'`,
      [lobby.code],
    );
    expect(rows.length).toBe(2);
    for (const row of rows) {
      const entry = finished.participants.find((participant) => participant.seat === row.seat);
      const expected = row.qualified ? Math.min(5, Number(row.total)) : 0;
      expect(entry?.rounds.length).toBe(expected);
    }

    for (const entry of finished.participants) {
      if (entry.season?.champion) {
        expect(entry.season.finishLabel).toBe('Champion');
      } else if (entry.season?.qualified === false) {
        expect(['Missed playoffs', 'Play-in exit']).toContain(entry.season.finishLabel);
      }
    }
    const champion = finished.participants.find((entry) => entry.season?.champion === true);
    if (champion) {
      expect(champion.season?.finishLabel).toBe('Champion');
      expect(finished.standings?.find((entry) => entry.seat === champion.seat)?.finishLabel).toBe('Champion');
      expect(finished.standings?.[0]?.seat).toBe(champion.seat);
    }
  });

  it('shows peer progress and a live activity line for every pick', async () => {
    const lobby = await newLobby('Host');
    const guest = await join(lobby.code, 'Guest');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    const draft = await draftFor('guard', 'current', 'high');
    const entries = Object.entries(draft.picks);
    const firstAttr = (entries[0] as [string, Pick])[0];
    const firstPick = (entries[0] as [string, Pick])[1];
    const secondAttr = (entries[1] as [string, Pick])[0];
    const secondPick = (entries[1] as [string, Pick])[1];

    const started = Date.now();
    const one = await buildHandler(
      authed(guest.seat.secret, `lobby/${lobby.code}/build`, {
        actionId: newActionId(),
        draft: { ...draft, picks: { [firstAttr]: firstPick }, spinIndex: 1, latest: { attr: firstAttr, playerName: firstPick.playerName } },
      }),
    );
    expect(one.status).toBe(200);
    const hostView = await view(lobby.code, lobby.host.secret);
    const roundTrip = Date.now() - started;
    const peer = hostView.participants.find((entry) => !entry.isMe);
    expect(peer?.summary).toEqual({ filled: 1, total: 10, latest: firstPick.playerName });
    expect(hostView.events[0]?.kind).toBe('pick');
    expect(hostView.events[0]?.name).toBe('Guest');
    expect(hostView.events[0]?.detail ?? '').toMatch(/^took .+'s [A-Z]{2,3} [A-Z][+-]?$/);
    expect(roundTrip, 'the pick sync and the peer read stay well inside the polling budget').toBeLessThan(5000);

    const two = await buildHandler(
      authed(guest.seat.secret, `lobby/${lobby.code}/build`, {
        actionId: newActionId(),
        draft: {
          ...draft,
          picks: { [firstAttr]: firstPick, [secondAttr]: secondPick },
          spinIndex: 2,
          latest: { attr: secondAttr, playerName: secondPick.playerName },
        },
      }),
    );
    expect(two.status).toBe(200);
    const nextView = await view(lobby.code, lobby.host.secret);
    expect(nextView.events[0]?.detail ?? '').toContain(secondPick.playerName);
    expect(nextView.events[0]?.detail).not.toBe(hostView.events[0]?.detail);
    expect(nextView.participants.find((entry) => !entry.isMe)?.summary?.filled).toBe(2);
  });

  it('keeps the finish rank out of the payload until the reveal catches up', async () => {
    const lobby = await newLobby('Host');
    const guest = await join(lobby.code, 'Guest');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    expect((await submit(lobby.code, lobby.host.secret, await draftFor('guard', 'current', 'high'))).status).toBe(200);
    expect((await submit(lobby.code, guest.seat.secret, await draftFor('big', 'current', 'high'))).status).toBe(200);
    await sleep(HOLD_WAIT);
    const released = await release(lobby.code, lobby.host.secret);
    expect(released.status).toBe(200);
    const opened = (await read<{ lobby: LobbyView }>(released)).lobby;
    expect(opened.phase).toBe('playoffs');
    expect(opened.roundsRevealed).toBeLessThanOrEqual(2);
    expect(opened.standings).toBeNull();

    const totals = await db().query<{ seat: number; total: string }>(
      `select p.seat, coalesce(jsonb_array_length(p.season->'playoffRounds'), 0) as total
       from participants p join lobbies l on l.id = p.lobby_id
       where l.code = $1 and p.status <> 'left'`,
      [lobby.code],
    );
    const raw = await (await viewHandler(poll(lobby.host.secret, lobby.code))).text();
    const body = JSON.parse(raw) as { lobby: LobbyView };
    expect(body.lobby.standings).toBeNull();
    expect(raw).not.toMatch(/"champion":true/);
    for (const entry of body.lobby.participants) {
      if (!entry.season) continue;
      expect(entry.rounds.length).toBeLessThanOrEqual(body.lobby.roundsRevealed);
      const total = Number(totals.find((row) => row.seat === entry.seat)?.total ?? '0');
      if (total <= body.lobby.roundsRevealed) continue;
      expect(entry.season.finishRank, `seat ${entry.seat} has an unfinished run`).toBeNull();
      expect(entry.season.finishLabel).toBeNull();
      expect(entry.season.champion).toBe(false);
    }
  });

  it('never reveals a playoff result beyond the revealed round', async () => {
    const lobby = await newLobby('Host');
    const guest = await join(lobby.code, 'Guest');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    expect((await submit(lobby.code, lobby.host.secret, await draftFor('guard', 'current', 'high'))).status).toBe(200);
    expect((await submit(lobby.code, guest.seat.secret, await draftFor('big', 'current', 'high'))).status).toBe(200);
    await sleep(HOLD_WAIT);
    const released = await release(lobby.code, lobby.host.secret);
    expect(released.status).toBe(200);
    const opened = (await read<{ lobby: LobbyView }>(released)).lobby;
    expect(opened.phase).toBe('playoffs');
    expect(opened.roundsRevealed).toBe(1);

    const totals = await db().query<{ seat: number; total: string }>(
      `select p.seat, coalesce(jsonb_array_length(p.season->'playoffRounds'), 0) as total
       from participants p join lobbies l on l.id = p.lobby_id
       where l.code = $1 and p.status <> 'left'`,
      [lobby.code],
    );
    for (const row of totals) {
      const entry = opened.participants.find((participantEntry) => participantEntry.seat === row.seat);
      if (!entry?.season) continue;
      const total = Number(row.total);
      if (total > opened.roundsRevealed) {
        expect(entry.season.finishLabel).toBeNull();
        expect(entry.season.champion).toBe(false);
      }
      expect(entry.rounds.length).toBe(Math.min(total, opened.roundsRevealed));
    }

    await db().query("update lobbies set playoffs_started_at = now() - interval '30 seconds' where code = $1", [
      lobby.code,
    ]);
    const finished = await view(lobby.code, lobby.host.secret);
    expect(finished.phase).toBe('finished');
    for (const entry of finished.participants) {
      if (!entry.season?.qualified) continue;
      expect(entry.season.finishLabel).not.toBeNull();
      if (entry.season.champion) expect(entry.season.finishLabel).toBe('Champion');
    }
  });

  it('carries every revealed round to a polling client', async () => {
    const lobby = await newLobby('Host');
    const guest = await join(lobby.code, 'Guest');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    expect((await submit(lobby.code, lobby.host.secret, await draftFor('guard', 'current', 'high'))).status).toBe(200);
    expect((await submit(lobby.code, guest.seat.secret, await draftFor('big', 'current', 'high'))).status).toBe(200);
    await sleep(HOLD_WAIT);
    const released = await release(lobby.code, lobby.host.secret);
    expect(released.status).toBe(200);
    const opened = (await read<{ lobby: LobbyView }>(released)).lobby;
    expect(opened.phase).toBe('playoffs');
    expect(opened.roundsRevealed).toBe(1);

    const since = opened.version;
    const token = progressToken(opened);
    const newest = opened.events[0]?.id ?? 0;
    const still = await viewHandler(poll(lobby.host.secret, lobby.code, since, token, newest));
    expect(still.status).toBe(204);

    await sleep(opened.revealSeconds * 1000 + 500);
    const advanced = await viewHandler(poll(lobby.host.secret, lobby.code, since, token, newest));
    expect(advanced.status).toBe(200);
    const body = await read<{ lobby?: LobbyView }>(advanced);
    expect(body.lobby).toBeDefined();
    const revealed = body.lobby as LobbyView;
    expect(revealed.roundsRevealed).toBeGreaterThan(opened.roundsRevealed);
    expect(revealed.version).toBeGreaterThan(since);
    expect(revealed.phase).toBe('playoffs');

    const peer = await view(lobby.code, guest.seat.secret);
    expect(peer.roundsRevealed).toBe(revealed.roundsRevealed);
    for (const entry of revealed.participants) {
      expect(entry.rounds.length).toBeLessThanOrEqual(revealed.roundsRevealed);
    }
  });

  it('frees the seat when a player leaves before the start', async () => {
    const lobby = await newLobby('Host');
    const guests = await Promise.all(Array.from({ length: 7 }, (_, index) => join(lobby.code, `P${index}`)));
    const full = await view(lobby.code, lobby.host.secret);
    expect(full.seatsTaken).toBe(8);
    expect((await join(lobby.code, 'Extra')).response.status).toBe(409);

    const leaver = guests[2]?.seat.secret as string;
    const left = await leaveHandler(authed(leaver, `lobby/${lobby.code}/leave`, { actionId: newActionId() }));
    expect(left.status).toBe(200);
    const afterLeave = await view(lobby.code, lobby.host.secret);
    expect(afterLeave.seatsTaken).toBe(7);
    expect(afterLeave.participants).toHaveLength(7);
    expect(await eventCount(lobby.code, 'left')).toBe(1);

    const replaced = await join(lobby.code, 'Replacement');
    expect(replaced.response.status).toBe(200);
    const seated = await view(lobby.code, lobby.host.secret);
    expect(seated.seatsTaken).toBe(8);
    expect(new Set(seated.participants.map((entry) => entry.seat)).size).toBe(8);
    expect(seated.participants.filter((entry) => entry.status !== 'left')).toHaveLength(8);

    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    const afterStart = await leaveHandler(
      authed(guests[0]?.seat.secret as string, `lobby/${lobby.code}/leave`, { actionId: newActionId() }),
    );
    expect(afterStart.status).toBe(200);
    const marked = await view(lobby.code, lobby.host.secret);
    expect(marked.participants.some((entry) => entry.status === 'left')).toBe(true);
    expect(marked.seatsTaken).toBe(7);
  });

  it('runs a solo lobby through the barrier to the standings', async () => {
    const lobby = await newLobby('Solo');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    expect((await submit(lobby.code, lobby.host.secret, await draftFor('guard', 'current', 'high'))).status).toBe(200);
    await sleep(HOLD_WAIT);

    const released = await release(lobby.code, lobby.host.secret);
    expect(released.status).toBe(200);
    const opened = (await read<{ lobby: LobbyView }>(released)).lobby;
    expect(opened.phase).toBe('playoffs');
    expect(opened.seatsTaken).toBe(1);
    expect(opened.hostSeat).toBe(1);
    expect(opened.me.season?.qualified).toBe(true);
    expect(opened.me.rounds.length).toBeGreaterThanOrEqual(1);

    await db().query("update lobbies set playoffs_started_at = now() - interval '30 seconds' where code = $1", [
      lobby.code,
    ]);
    const finished = await view(lobby.code, lobby.host.secret);
    expect(finished.phase).toBe('finished');
    expect(finished.standings?.length).toBe(1);
    expect(finished.standings?.[0]?.record).toMatch(/^\d+-\d+$/);
    expect(await eventCount(lobby.code, 'playoffs_started')).toBe(1);
  });

  it('polls with since and answers 204 while nothing changed', async () => {
    const lobby = await newLobby('Host');
    const first = await view(lobby.code, lobby.host.secret);
    const unchanged = await viewHandler(poll(lobby.host.secret, lobby.code, first.version));
    expect(unchanged.status).toBe(204);
    expect(await unchanged.text()).toBe('');
    const guest = await join(lobby.code, 'Guest');
    expect(guest.response.status).toBe(200);
    const changed = await viewHandler(poll(lobby.host.secret, lobby.code, first.version));
    expect(changed.status).toBe(200);
    expect((await read<{ lobby: LobbyView }>(changed)).lobby.version).toBeGreaterThan(first.version);
  });

  it('never exposes secrets or hashes in the lobby view', async () => {
    const lobby = await newLobby('Host');
    const guest = await join(lobby.code, 'Guest');
    const response = await viewHandler(poll(lobby.host.secret, lobby.code));
    const text = await response.text();
    expect(text).not.toContain(lobby.host.secret);
    expect(text).not.toContain(guest.seat.secret);
    expect(text).not.toContain('token_hash');
    expect(text).not.toContain('tokenHash');
    expect(text).not.toMatch(/[0-9a-f]{64}/);
    const probe = await joinHandler(authed(generateSecret(), `lobby/${lobby.code}/join`, { name: 'Probe', actionId: newActionId() }));
    expect(probe.status).toBe(200);
    const probeText = await (await viewHandler(poll(lobby.host.secret, lobby.code))).text();
    expect(probeText).not.toMatch(/[0-9a-f]{64}/);
  });

  it('does not seat a ninth participant after one leaves', async () => {
    const lobby = await newLobby('Host');
    await Promise.all(Array.from({ length: 7 }, (_, index) => join(lobby.code, `P${index}`)));
    const seated = await view(lobby.code, lobby.host.secret);
    expect(seated.seatsTaken).toBe(8);
    const extra = await join(lobby.code, 'Extra');
    expect(extra.response.status).toBe(409);
    expect((await read<{ error: string }>(extra.response)).error).toMatch(/full/i);
  });

  it('sends draft progress as a delta without moving the version peers hold', async () => {
    const lobby = await newLobby('Host');
    const guest = await join(lobby.code, 'Guest');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    const guestView = await view(lobby.code, guest.seat.secret);
    const token = progressToken(guestView);
    const newest = guestView.events[0]?.id ?? 0;

    const still = await viewHandler(poll(guest.seat.secret, lobby.code, guestView.version, token, newest));
    expect(still.status).toBe(204);

    const full = await draftFor('guard', 'current', 'high');
    const partial: BuildDraft = {
      ...full,
      picks: Object.fromEntries(Object.entries(full.picks).slice(0, 2)),
      spinIndex: 2,
      latest: { attr: 'jumpShot', playerName: 'Stephen Curry' },
    };
    const synced = await buildHandler(
      authed(lobby.host.secret, `lobby/${lobby.code}/build`, { actionId: newActionId(), draft: partial }),
    );
    expect(synced.status).toBe(200);
    expect((await read<{ lobby: LobbyView }>(synced)).lobby.version).toBe(guestView.version);

    const peer = await viewHandler(poll(guest.seat.secret, lobby.code, guestView.version, token, newest));
    expect(peer.status).toBe(200);
    const delta = (await read<{ delta: LobbyDelta }>(peer)).delta;
    expect(delta.version).toBe(guestView.version);
    expect(delta.participants.find((entry) => entry.seat === 1)?.summary?.filled).toBe(2);
    expect(delta.events.some((entry) => entry.kind === 'pick')).toBe(true);
    expect((await view(lobby.code, guest.seat.secret)).me.build).toBeNull();
  });
});

describe('seat maths', () => {
  it('keeps probe helpers honest', async () => {
    const lobby = await newLobby('Host');
    const taken = await seatsOf(lobby.code);
    expect(taken.length).toBe(7);
  });
});

describe('database round trips', () => {
  it('syncs a draft in a handful of requests instead of three maintenance statements', async () => {
    await loadCatalog();
    const lobby = await newLobby('Round Trips');
    await join(lobby.code, 'Guest');
    expect((await start(lobby.code, lobby.host.secret)).status).toBe(200);
    const draft = await draftFor('guard', 'current', 'high');
    const real = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return real(input, init);
    }) as typeof fetch;
    let status = 0;
    try {
      const response = await buildHandler(
        authed(lobby.host.secret, `lobby/${lobby.code}/build`, { actionId: newActionId(), draft }),
      );
      status = response.status;
    } finally {
      globalThis.fetch = real;
    }
    expect(status).toBe(200);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.length).toBeLessThanOrEqual(4);
  });
});
