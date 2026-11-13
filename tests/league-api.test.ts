import { afterAll, describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { POST as createHandler } from '../api/lobby/index';
import { GET as viewHandler } from '../api/lobby/[code]/index';
import { POST as joinHandler } from '../api/lobby/[code]/join';
import { POST as startHandler } from '../api/lobby/[code]/start';
import { POST as drawHandler } from '../api/lobby/[code]/draw';
import { POST as rerollHandler } from '../api/lobby/[code]/reroll';
import { POST as lockHandler } from '../api/lobby/[code]/lock';
import { POST as buildHandler } from '../api/lobby/[code]/build';
import { POST as readyHandler } from '../api/lobby/[code]/ready';
import { POST as advanceHandler } from '../api/lobby/[code]/advance';
import { POST as rematchHandler } from '../api/lobby/[code]/rematch';
import { loadLocalEnv } from '../scripts/lib.ts';
import { db } from '../src/server/db';
import { loadCatalog, poolFor } from '../src/shared/data/loader';
import { BIG_ATTRS, GUARD_ATTRS } from '../src/shared/engine/rules';
import type { LeagueResult } from '../src/shared/engine/league';
import type { Era, Pick, Position } from '../src/shared/engine/types';
import { generateSecret, newActionId } from '../src/shared/mp/codes';
import { stageTotal } from '../src/shared/mp/league';
import { LobbyEnvelopeSchema } from '../src/shared/mp/schemas';
import type {
  LobbyBuild,
  LobbySettings,
  LobbyView,
  NormalBuild,
  SalaryBuild,
  SalaryCardPick,
  SquadBuild,
} from '../src/shared/mp/types';

const BASE = 'http://localhost:4173/api';
const created: string[] = [];

loadLocalEnv();
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

afterAll(async () => {
  if (!created.length) return;
  await db().query('delete from lobbies where code = any($1::text[])', [created]);
  const rows = await db().query<{ count: string }>('select count(*)::text as count from lobbies where code = any($1::text[])', [created]);
  expect(rows[0]?.count).toBe('0');
});

function authed(secret: string, path: string, body: unknown): Request {
  return new Request(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
}

function poll(secret: string, code: string): Request {
  return new Request(`${BASE}/lobby/${code}`, { headers: { authorization: `Bearer ${secret}` } });
}

async function read<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface Seat {
  secret: string;
  seat: number;
}

async function createLobby(name: string, settings: LobbySettings): Promise<{ code: string; host: Seat; view: LobbyView }> {
  const secret = generateSecret();
  const response = await createHandler(authed(secret, 'lobby', { name, actionId: newActionId(), settings }));
  expect(response.status).toBe(201);
  const body = await read<{ lobby: LobbyView; code: string; seat: number }>(response);
  created.push(body.code);
  return { code: body.code, host: { secret, seat: body.seat }, view: body.lobby };
}

async function join(code: string, name: string): Promise<Seat> {
  const secret = generateSecret();
  const response = await joinHandler(authed(secret, `lobby/${code}/join`, { name, actionId: newActionId() }));
  expect(response.status).toBe(200);
  const body = await read<{ lobby: LobbyView }>(response);
  return { secret, seat: body.lobby.me.seat };
}

async function start(code: string, secret: string, settings: LobbySettings): Promise<void> {
  const response = await startHandler(authed(secret, `lobby/${code}/start`, { actionId: newActionId(), settings }));
  expect(response.status).toBe(200);
}

async function draw(code: string, secret: string, actionId = newActionId()): Promise<LobbyView> {
  const response = await drawHandler(authed(secret, `lobby/${code}/draw`, { actionId }));
  expect(response.status).toBe(200);
  return (await read<{ lobby: LobbyView }>(response)).lobby;
}

async function reroll(code: string, secret: string, actionId = newActionId()): Promise<LobbyView> {
  const response = await rerollHandler(authed(secret, `lobby/${code}/reroll`, { actionId }));
  expect(response.status).toBe(200);
  return (await read<{ lobby: LobbyView }>(response)).lobby;
}

async function lock(code: string, secret: string): Promise<void> {
  const response = await lockHandler(authed(secret, `lobby/${code}/lock`, { actionId: newActionId() }));
  expect(response.status).toBe(200);
}

async function submit(code: string, secret: string, build: LobbyBuild): Promise<void> {
  const response = await buildHandler(authed(secret, `lobby/${code}/build`, { actionId: newActionId(), build }));
  expect(response.status).toBe(200);
}

async function ready(code: string, secret: string, stage: number): Promise<void> {
  const response = await readyHandler(authed(secret, `lobby/${code}/ready`, { actionId: newActionId(), stage }));
  expect(response.status).toBe(200);
}

async function advance(code: string, secret: string, stage: number, actionId = newActionId()): Promise<Response> {
  return advanceHandler(authed(secret, `lobby/${code}/advance`, { actionId, stage }));
}

async function view(code: string, secret: string): Promise<LobbyView> {
  const response = await viewHandler(poll(secret, code));
  expect(response.status).toBe(200);
  return (await read<{ lobby: LobbyView }>(response)).lobby;
}

async function fastForward(code: string): Promise<void> {
  const rows = await db().query<{ id: string; stage: number; league: unknown }>('select id, stage, league from lobbies where code = $1', [code]);
  const row = rows[0];
  if (!row) throw new Error('lobby missing');
  const league = row.league as LeagueResult;
  const total = stageTotal(league, row.stage);
  await db().query("update lobbies set stage_started_at = now() - interval '1 hour', stage_cursor = $2 where id = $1::uuid", [row.id, total]);
}

async function normalBuild(position: Position, era: Era, strength: 'high' | 'low'): Promise<NormalBuild> {
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
    picks[attr] = { attr, val: player.attrs[attr] ?? 0, playerName: player.name, playerShort: player.short, team: player.team };
  }
  return { kind: 'normal', position, era, picks };
}

function salaryBuild(lobby: LobbyView): SalaryBuild {
  const board = lobby.salaryBoard;
  if (!board) throw new Error('salary board missing');
  const cards: SalaryCardPick[] = board.map((column) => {
    const cheapest = [...column].sort((a, b) => a.price - b.price)[0];
    if (!cheapest) throw new Error('empty salary column');
    return cheapest;
  });
  return { kind: 'salary', position: cards[4]?.posGroup ?? 'guard', cards };
}

async function squadBuild(era: Era): Promise<SquadBuild> {
  const slots: { slot: string; position: Position }[] = [
    { slot: 'PG', position: 'guard' },
    { slot: 'SG', position: 'guard' },
    { slot: 'SF', position: 'guard' },
    { slot: 'PF', position: 'big' },
    { slot: 'C', position: 'big' },
  ];
  const players = [];
  for (const entry of slots) {
    const build = await normalBuild(entry.position, era, 'high');
    players.push({ slot: entry.slot, position: entry.position, picks: build.picks });
  }
  return { kind: 'squad', players };
}

async function buildFor(mode: LobbySettings['mode'], lobby: LobbyView, index: number): Promise<LobbyBuild> {
  if (mode === 'normal') return normalBuild(index % 2 === 0 ? 'guard' : 'big', lobby.settings.era, index % 3 === 0 ? 'low' : 'high');
  if (mode === 'salary') return salaryBuild(lobby);
  return squadBuild(lobby.settings.era);
}

async function runLeague(mode: LobbySettings['mode']): Promise<{ code: string; seats: Seat[]; view: LobbyView }> {
  const settings: LobbySettings = { era: 'current', mode };
  const host = await createLobby('Host', settings);
  const seats: Seat[] = [host.host];
  for (let index = 2; index <= 8; index++) seats.push(await join(host.code, `P${index}`));
  await start(host.code, host.host.secret, settings);
  await Promise.all(seats.map((seat) => draw(host.code, seat.secret)));
  await lock(host.code, host.host.secret);
  for (let index = 0; index < seats.length; index++) {
    const seat = seats[index] as Seat;
    const lobby = await view(host.code, seat.secret);
    if (mode === 'salary' && index === 0) expect(v.safeParse(LobbyEnvelopeSchema, { lobby }).success).toBe(true);
    await submit(host.code, seat.secret, await buildFor(mode, lobby, index));
  }
  for (const seat of seats) await ready(host.code, seat.secret, 0);
  let lobby = await view(host.code, host.host.secret);
  expect(lobby.phase).toBe('season');
  expect(lobby.league?.games).toHaveLength(0);
  expect(lobby.league?.awards).toBeNull();
  expect(lobby.league?.playoffs).toBeNull();
  expect(lobby.league?.recap).toBeNull();
  expect(lobby.league?.standings?.every((row) => row.seed === null)).toBe(true);

  for (let guard = 0; guard < 12; guard++) {
    const before = await view(host.code, host.host.secret);
    if (before.phase === 'recap') break;
    await fastForward(host.code);
    const current = await view(host.code, host.host.secret);
    for (const seat of seats) await ready(host.code, seat.secret, current.stage);
    const after = await view(host.code, host.host.secret);
    expect(after.stage).toBeGreaterThan(current.stage);
  }

  lobby = await view(host.code, host.host.secret);
  expect(lobby.phase).toBe('recap');
  expect(lobby.league?.recap).not.toBeNull();
  expect(lobby.league?.recap?.champion).toBeTruthy();
  expect(v.safeParse(LobbyEnvelopeSchema, { lobby }).success).toBe(true);
  return { code: host.code, seats, view: lobby };
}

describeDb('shared league API', () => {
  it('runs a complete 8-player normal league to recap', async () => {
    const { code, seats, view: recap } = await runLeague('normal');
    const views = await Promise.all(seats.map((seat) => view(code, seat.secret)));
    for (const lobby of views) {
      expect(lobby.league?.recap?.champion).toBe(recap.league?.recap?.champion);
      expect(lobby.league?.playoffs).toEqual(recap.league?.playoffs);
      expect(lobby.league?.playin).toEqual(recap.league?.playin);
      expect(lobby.league?.recap?.entries).toEqual(recap.league?.recap?.entries);
    }
    const rows = await db().query<{ count: string; unique_count: string }>(
      'select count(*)::text as count, count(distinct game_no)::text as unique_count from league_games where lobby_id = (select id from lobbies where code = $1)',
      [code],
    );
    expect(rows[0]?.count).toBe(rows[0]?.unique_count);
    expect(Number(rows[0]?.count)).toBeGreaterThan(1230);
  }, 120_000);

  it('runs a complete 8-player salary league to recap', async () => {
    const { view: recap } = await runLeague('salary');
    expect(recap.league?.recap?.champion).toBeTruthy();
    expect(recap.league?.awards).not.toBeNull();
  }, 120_000);

  it('runs a complete 8-player squad league to recap', async () => {
    const { view: recap } = await runLeague('squad');
    expect(recap.league?.recap?.champion).toBeTruthy();
    expect(recap.league?.awards).not.toBeNull();
  }, 120_000);

  it('draws unique teams and spends exactly one reroll under concurrency', async () => {
    const settings: LobbySettings = { era: 'current', mode: 'normal' };
    const host = await createLobby('Host', settings);
    const seats: Seat[] = [host.host];
    for (let index = 2; index <= 8; index++) seats.push(await join(host.code, `P${index}`));
    await start(host.code, host.host.secret, settings);
    await Promise.all(seats.map((seat) => draw(host.code, seat.secret)));
    let lobby = await view(host.code, host.host.secret);
    expect(v.safeParse(LobbyEnvelopeSchema, { lobby }).success).toBe(true);
    expect(new Set(lobby.teams.map((entry) => entry.team)).size).toBe(8);
    await Promise.all(seats.map((seat) => reroll(host.code, seat.secret)));
    lobby = await view(host.code, host.host.secret);
    expect(new Set(lobby.teams.map((entry) => entry.team)).size).toBe(8);
    expect(lobby.teams.every((entry) => entry.rerollUsed)).toBe(true);

    const first = seats[0] as Seat;
    const actionId = newActionId();
    const before = lobby.teams.find((entry) => entry.seat === first.seat)?.team;
    await reroll(host.code, first.secret, actionId);
    await reroll(host.code, first.secret, actionId);
    const after = await view(host.code, first.secret);
    expect(after.teams.find((entry) => entry.seat === first.seat)?.team).toBe(before);
    expect(after.teams.find((entry) => entry.seat === first.seat)?.rerollUsed).toBe(true);
  }, 60_000);

  it('advances a checkpoint once and never skips on a retry', async () => {
    const settings: LobbySettings = { era: 'current', mode: 'normal' };
    const host = await createLobby('Host', settings);
    const seats: Seat[] = [host.host];
    for (let index = 2; index <= 8; index++) seats.push(await join(host.code, `P${index}`));
    await start(host.code, host.host.secret, settings);
    await Promise.all(seats.map((seat) => draw(host.code, seat.secret)));
    await lock(host.code, host.host.secret);
    for (let index = 0; index < seats.length; index++) {
      const seat = seats[index] as Seat;
      const lobby = await view(host.code, seat.secret);
      await submit(host.code, seat.secret, await buildFor('normal', lobby, index));
    }
    for (const seat of seats) await ready(host.code, seat.secret, 0);
    await fastForward(host.code);
    const before = await view(host.code, host.host.secret);
    const actionId = newActionId();
    const first = await advance(host.code, host.host.secret, before.stage, actionId);
    expect(first.status).toBe(200);
    const second = await advance(host.code, host.host.secret, before.stage, actionId);
    expect(second.status).toBe(200);
    const after = await view(host.code, host.host.secret);
    expect(after.stage).toBe(before.stage + 1);
    const stale = await advance(host.code, host.host.secret, before.stage);
    expect(stale.status).toBe(200);
    const still = await view(host.code, host.host.secret);
    expect(still.stage).toBe(after.stage);
  }, 60_000);

  it('does not let an away player block a checkpoint', async () => {
    const settings: LobbySettings = { era: 'current', mode: 'normal' };
    const host = await createLobby('Host', settings);
    const seats: Seat[] = [host.host];
    for (let index = 2; index <= 8; index++) seats.push(await join(host.code, `P${index}`));
    await start(host.code, host.host.secret, settings);
    await Promise.all(seats.map((seat) => draw(host.code, seat.secret)));
    await lock(host.code, host.host.secret);
    for (let index = 0; index < seats.length; index++) {
      const seat = seats[index] as Seat;
      const lobby = await view(host.code, seat.secret);
      await submit(host.code, seat.secret, await buildFor('normal', lobby, index));
    }
    for (const seat of seats) await ready(host.code, seat.secret, 0);
    await fastForward(host.code);
    const before = await view(host.code, host.host.secret);
    const away = seats[7] as Seat;
    await db().query(
      "update participants set last_seen = now() - interval '10 minutes' where lobby_id = (select id from lobbies where code = $1) and seat = $2",
      [host.code, away.seat],
    );
    for (const seat of seats.slice(0, 7)) await ready(host.code, seat.secret, before.stage);
    const after = await view(host.code, host.host.secret);
    expect(after.stage).toBe(before.stage + 1);
  }, 60_000);

  it('keeps seats and the code on a rematch', async () => {
    const { code, seats } = await runLeague('normal');
    const response = await rematchHandler(authed(seats[0]!.secret, `lobby/${code}/rematch`, { actionId: newActionId() }));
    expect(response.status).toBe(200);
    const lobby = (await read<{ lobby: LobbyView }>(response)).lobby;
    expect(lobby.code).toBe(code);
    expect(lobby.phase).toBe('draw');
    expect(lobby.participants).toHaveLength(8);
    expect(lobby.teams).toHaveLength(0);
    expect(lobby.league).toBeNull();
  }, 120_000);
});
