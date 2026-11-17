import { afterAll, describe, expect, it } from 'vitest';
import { POST as createHandler } from '../api/lobby/index';
import { GET as viewHandler } from '../api/lobby/[code]/index';
import {
  advanceAction as advanceHandler,
  joinAction as joinHandler,
  lockAction as lockHandler,
  readyAction as readyHandler,
  startAction as startHandler,
} from '../src/server/actions';
import { loadLocalEnv } from '../scripts/lib.ts';
import { db } from '../src/server/db';
import type { LeagueResult } from '../src/shared/engine/league';
import { generateSecret, newActionId } from '../src/shared/mp/codes';
import { stageGamesTotal } from '../src/shared/mp/league';
import type { LobbySettings, LobbyView } from '../src/shared/mp/types';

const BASE = 'http://localhost:4173/api';
const created: string[] = [];

loadLocalEnv();
const describeDb = /^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? '') ? describe : describe.skip;

afterAll(async () => {
  if (!created.length) return;
  await db().query('delete from lobbies where code = any($1::text[])', [created]);
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

async function view(code: string, secret: string): Promise<LobbyView> {
  const response = await viewHandler(poll(secret, code));
  expect(response.status).toBe(200);
  return (await read<{ lobby: LobbyView }>(response)).lobby;
}

async function createLobby(name: string, settings: LobbySettings): Promise<{ code: string; host: Seat }> {
  const secret = generateSecret();
  const response = await createHandler(authed(secret, 'lobby', { name, actionId: newActionId(), settings }));
  expect(response.status).toBe(201);
  const body = await read<{ code: string; seat: number }>(response);
  created.push(body.code);
  return { code: body.code, host: { secret, seat: body.seat } };
}

async function join(code: string, name: string): Promise<Seat> {
  const secret = generateSecret();
  const response = await joinHandler(authed(secret, `lobby/${code}/join`, { name, actionId: newActionId() }));
  expect(response.status).toBe(200);
  const body = await read<{ lobby: LobbyView }>(response);
  return { secret, seat: body.lobby.me.seat };
}

async function start(code: string, secret: string, settings: LobbySettings): Promise<void> {
  expect((await startHandler(authed(secret, `lobby/${code}/start`, { actionId: newActionId(), settings }))).status).toBe(200);
}

async function lock(code: string, secret: string): Promise<void> {
  expect((await lockHandler(authed(secret, `lobby/${code}/lock`, { actionId: newActionId() }))).status).toBe(200);
}

async function advance(code: string, secret: string, stage: number, actionId = newActionId()): Promise<Response> {
  return advanceHandler(authed(secret, `lobby/${code}/advance`, { actionId, stage }));
}

async function ready(code: string, secret: string, stage: number, actionId = newActionId()): Promise<Response> {
  return readyHandler(authed(secret, `lobby/${code}/ready`, { actionId, stage }));
}

async function seasonLeague(players = 2): Promise<{ code: string; seats: Seat[] }> {
  const settings: LobbySettings = { era: 'current', mode: 'normal' };
  const host = await createLobby('Host', settings);
  const seats: Seat[] = [host.host];
  for (let index = 2; index <= players; index++) seats.push(await join(host.code, `P${index}`));
  await start(host.code, host.host.secret, settings);
  expect((await advance(host.code, host.host.secret, 0)).status).toBe(200);
  await lock(host.code, host.host.secret);
  for (const seat of seats) expect((await ready(host.code, seat.secret, 0)).status).toBe(200);
  const season = await view(host.code, host.host.secret);
  expect(season.phase).toBe('season');
  expect(season.stage).toBe(0);
  return { code: host.code, seats };
}

async function fastForward(code: string): Promise<void> {
  await db().query("update lobbies set stage_started_at = now() - interval '1 hour', stage_cursor = 100000 where code = $1", [code]);
}

async function checkpointEvents(code: string): Promise<number> {
  const rows = await db().query<{ n: number }>(
    "select count(*)::int as n from events where lobby_id = (select id from lobbies where code = $1) and kind = 'checkpoint'",
    [code],
  );
  return rows[0]?.n ?? 0;
}

describeDb('shared league stage defects', () => {
  it.fails('logs one checkpoint event for the end of the regular season on host Advance', async () => {
    const { code, seats } = await seasonLeague();
    const before = await checkpointEvents(code);
    await fastForward(code);
    expect((await advance(code, seats[0]!.secret, 0)).status).toBe(200);
    const after = await view(code, seats[0]!.secret);
    expect(after.stage).toBe(4);
    expect(after.phase).toBe('awards');
    expect((await checkpointEvents(code)) - before).toBe(1);
  }, 120_000);

  it.fails('shows a playoff checkpoint whose cursor reaches its stageTotal', async () => {
    const { code, seats } = await seasonLeague();
    const rows = await db().query<{ league: LeagueResult }>('select league from lobbies where code = $1', [code]);
    const league = rows[0]?.league;
    if (!league) throw new Error('league missing');
    const actual = stageGamesTotal(league, 6);
    expect(actual).toBeGreaterThan(0);
    await db().query(
      "update lobbies set stage = 6, phase = 'playoffs', stage_cursor = $2, stage_started_at = now() - interval '1 hour' where code = $1",
      [code, actual],
    );
    const lobby = await view(code, seats[0]!.secret);
    expect(lobby.league?.checkpoint).toBe(true);
    expect(lobby.league?.cursor).toBe(actual);
    expect(lobby.league?.stageTotal).toBe(actual);
  }, 120_000);

  it('advances exactly one stage under duplicate, stale and concurrent ready and advance', async () => {
    const { code, seats } = await seasonLeague();
    const seen: number[] = [];
    const record = (lobby: LobbyView) => {
      if (seen[seen.length - 1] !== lobby.stage) seen.push(lobby.stage);
    };
    for (let guard = 0; guard < 12; guard++) {
      let lobby = await view(code, seats[0]!.secret);
      record(lobby);
      if (lobby.phase === 'recap') break;
      await fastForward(code);
      lobby = await view(code, seats[0]!.secret);
      record(lobby);
      if (lobby.phase === 'recap') break;
      const stage = lobby.stage;
      const shared = newActionId();
      const calls = seats.map((seat, index) => ready(code, seat.secret, stage, index === 0 ? shared : newActionId()));
      calls.push(ready(code, seats[0]!.secret, stage, shared));
      calls.push(advance(code, seats[0]!.secret, Math.max(0, stage - 1)));
      calls.push(advance(code, seats[0]!.secret, stage));
      await Promise.all(calls);
      const after = await view(code, seats[0]!.secret);
      expect(after.stage).toBe(stage + 1);
      expect(after.stage).toBe(lobby.stage + 1);
      const peer = await view(code, seats[1]!.secret);
      expect(peer.stage).toBe(after.stage);
      expect(peer.phase).toBe(after.phase);
      expect(peer.league?.cursor).toBe(after.league?.cursor);
      record(after);
    }
    expect(seen).toEqual([0, 4, 5, 6, 7, 8, 9, 10]);
    expect(await checkpointEvents(code)).toBe(7);
  }, 180_000);
});
