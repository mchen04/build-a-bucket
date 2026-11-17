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
import { readLeagueView } from '../src/server/leagueSlice';
import type { LeagueResult } from '../src/shared/engine/league';
import { generateSecret, newActionId } from '../src/shared/mp/codes';
import { stageGamesTotal } from '../src/shared/mp/league';
import type { LeagueClock } from '../src/shared/mp/league';
import { progressToken } from '../src/shared/mp/progress';
import { gateViewFor, stageEvents, type RawParticipant } from '../src/server/lobby';
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

async function lobbyRow(code: string): Promise<{ id: string; league: LeagueResult }> {
  const rows = await db().query<{ id: string; league: LeagueResult }>('select id, league from lobbies where code = $1', [code]);
  const row = rows[0];
  if (!row) throw new Error('lobby missing');
  return row;
}

async function participantId(lobbyId: string, seat: number): Promise<string> {
  const rows = await db().query<{ id: string }>('select id from participants where lobby_id = $1::uuid and seat = $2', [lobbyId, seat]);
  const id = rows[0]?.id;
  if (!id) throw new Error('participant missing');
  return id;
}

async function setTeams(code: string, teams: string[]): Promise<void> {
  const row = await lobbyRow(code);
  const seats = await db().query<{ id: string; seat: number }>('select id, seat from participants where lobby_id = $1::uuid order by seat', [row.id]);
  for (const seat of seats) {
    await db().query('update lobby_teams set team = $2 where lobby_id = $1::uuid and participant_id = $3::uuid', [row.id, `__tmp-${seat.seat}`, seat.id]);
  }
  for (const seat of seats) {
    const team = teams[seat.seat - 1];
    if (!team) continue;
    await db().query('update lobby_teams set team = $2 where lobby_id = $1::uuid and participant_id = $3::uuid', [row.id, team, seat.id]);
  }
}

async function setStage(code: string, stage: number, phase: string, cursor = 0): Promise<void> {
  await db().query(
    "update lobbies set stage = $2, phase = $3, stage_cursor = $4, stage_started_at = case when $2 = 6 then null else now() - interval '1 hour' end where code = $1",
    [code, stage, phase, cursor],
  );
}

async function eventsOfKind(code: string, kind: string): Promise<{ detail: string | null; key: string | null }[]> {
  const rows = await db().query<{ detail: string | null; key: string | null }>(
    "select payload->>'detail' as detail, payload->>'key' as key from events where lobby_id = (select id from lobbies where code = $1) and kind = $2 order by id",
    [code, kind],
  );
  return rows;
}

async function duplicateEvents(code: string): Promise<{ kind: string; key: string; n: number }[]> {
  const rows = await db().query<{ kind: string; key: string; n: number }>(
    `select kind, payload->>'key' as key, count(*)::int as n from events
     where lobby_id = (select id from lobbies where code = $1) and payload ? 'key'
     group by kind, payload->>'key' having count(*) > 1`,
    [code],
  );
  return rows;
}

describeDb('shared league stage behavior', () => {
  it('moves from the regular season to the awards and logs one season final per human', async () => {
    const { code, seats } = await seasonLeague();
    await fastForward(code);
    expect((await advance(code, seats[0]!.secret, 0)).status).toBe(200);
    const after = await view(code, seats[0]!.secret);
    expect(after.stage).toBeGreaterThanOrEqual(4);
    expect(after.phase === 'awards' || after.phase === 'playin' || after.phase === 'playoffs').toBe(true);
    expect(await eventsOfKind(code, 'season_final')).toHaveLength(2);
    expect(await eventsOfKind(code, 'checkpoint')).toHaveLength(0);
  }, 120_000);

  it('shows a playoff checkpoint whose cursor reaches its stageTotal', async () => {
    const { code, seats } = await seasonLeague();
    const row = await lobbyRow(code);
    const actual = stageGamesTotal(row.league, 7);
    expect(actual).toBeGreaterThan(0);
    const me = await participantId(row.id, seats[0]!.seat);
    const slice = await readLeagueView(row.id, 7, actual, me);
    expect(slice?.view.checkpoint).toBe(true);
    expect(slice?.view.cursor).toBe(actual);
    expect(slice?.view.stageTotal).toBe(actual);
  }, 120_000);

  it('gates the playoffs on qualifying humans only and lets the host start', async () => {
    const { code, seats } = await seasonLeague();
    const row = await lobbyRow(code);
    const qualified = [...new Set(row.league.series.filter((series) => series.round === 1).flatMap((series) => [series.high, series.low]))];
    const nonQualified = row.league.standings.east.concat(row.league.standings.west).map((entry) => entry.team).filter((team) => !qualified.includes(team));
    expect(qualified.length).toBeGreaterThan(0);
    expect(nonQualified.length).toBeGreaterThan(1);
    await setTeams(code, [qualified[0]!, nonQualified[0]!]);
    await setStage(code, 6, 'playoffs');

    const host = await view(code, seats[0]!.secret);
    expect(host.gate?.active).toBe(true);
    expect(host.gate?.mine).toBe(true);
    expect(host.gate?.qualified).toBe(1);
    expect(host.gate?.ready).toBe(0);
    expect(host.gate?.nextAction).toContain('Start the playoffs');

    const guest = await view(code, seats[1]!.secret);
    expect(guest.gate?.active).toBe(true);
    expect(guest.gate?.mine).toBe(false);
    expect(guest.gate?.nextAction).toContain('Waiting on Host');

    expect((await ready(code, seats[1]!.secret, 6)).status).toBe(200);
    const afterGuest = await view(code, seats[0]!.secret);
    expect(afterGuest.gate?.active).toBe(true);
    expect(afterGuest.gate?.ready).toBe(0);

    expect((await ready(code, seats[0]!.secret, 6)).status).toBe(200);
    const started = await view(code, seats[0]!.secret);
    expect(started.stage).toBeGreaterThanOrEqual(6);
    expect(started.gate).toBeNull();

    await setStage(code, 6, 'playoffs');
    expect((await advance(code, seats[0]!.secret, 6)).status).toBe(200);
    const advanced = await view(code, seats[0]!.secret);
    expect(advanced.stage).toBeGreaterThanOrEqual(6);
    expect(advanced.gate).toBeNull();
  }, 120_000);

  it('skips the playoff gate when no human qualified', async () => {
    const { code, seats } = await seasonLeague();
    const row = await lobbyRow(code);
    const qualified = new Set(row.league.series.filter((series) => series.round === 1).flatMap((series) => [series.high, series.low]));
    const nonQualified = row.league.standings.east.concat(row.league.standings.west).map((entry) => entry.team).filter((team) => !qualified.has(team));
    await setTeams(code, [nonQualified[0]!, nonQualified[1]!]);
    await setStage(code, 6, 'playoffs');
    const lobby = await view(code, seats[0]!.secret);
    expect(lobby.stage).toBeGreaterThanOrEqual(6);
    expect(lobby.gate).toBeNull();
  }, 120_000);

  it('logs season, series, elimination and champion events once and exposes them to every seat', async () => {
    const { code, seats } = await seasonLeague();
    for (let guard = 0; guard < 20; guard++) {
      let lobby = await view(code, seats[0]!.secret);
      if (lobby.phase === 'recap') break;
      await fastForward(code);
      lobby = await view(code, seats[0]!.secret);
      if (lobby.phase === 'recap') break;
      if (lobby.stage === 6) {
        await Promise.all([
          advance(code, seats[0]!.secret, 6),
          ready(code, seats[0]!.secret, 6),
          ready(code, seats[1]!.secret, 6),
          view(code, seats[0]!.secret),
          view(code, seats[1]!.secret),
        ]);
      }
    }
    const recap = await view(code, seats[0]!.secret);
    expect(recap.phase).toBe('recap');
    expect(await eventsOfKind(code, 'season_final')).toHaveLength(2);
    expect((await eventsOfKind(code, 'champion')).length).toBe(1);
    const duplicates = await duplicateEvents(code);
    expect(duplicates, JSON.stringify(duplicates)).toEqual([]);
    const guest = await view(code, seats[1]!.secret);
    expect(guest.events.some((event) => event.kind === 'season_final')).toBe(true);
    expect(guest.events.some((event) => event.kind === 'champion')).toBe(true);
  }, 180_000);

  it('continues an old-model lobby from a mid-playoff checkpoint', async () => {
    const { code, seats } = await seasonLeague();
    await setStage(code, 7, 'playoffs', 100000);
    const next = await view(code, seats[0]!.secret);
    expect(next.stage).toBe(8);
    expect(next.phase).toBe('playoffs');
    await setStage(code, 4, 'awards', 0);
    const awards = await view(code, seats[0]!.secret);
    expect(awards.stage).toBeGreaterThanOrEqual(5);
  }, 120_000);

  it('advances monotonically under duplicate, stale and concurrent ready, advance and poll', async () => {
    const { code, seats } = await seasonLeague();
    const seen: number[] = [];
    const record = (lobby: LobbyView) => {
      if (seen[seen.length - 1] !== lobby.stage) seen.push(lobby.stage);
    };
    for (let guard = 0; guard < 20; guard++) {
      let lobby = await view(code, seats[0]!.secret);
      record(lobby);
      if (lobby.phase === 'recap') break;
      if (lobby.stage !== 6 || !lobby.gate) {
        await fastForward(code);
        lobby = await view(code, seats[0]!.secret);
        record(lobby);
        if (lobby.phase === 'recap') break;
      }
      const stage = lobby.stage;
      if (stage === 6) {
        const shared = newActionId();
        await Promise.all([
          ready(code, seats[0]!.secret, 6, shared),
          ready(code, seats[1]!.secret, 6, shared),
          ready(code, seats[0]!.secret, 6, shared),
          advance(code, seats[0]!.secret, 5),
          advance(code, seats[0]!.secret, 6),
          view(code, seats[0]!.secret),
          view(code, seats[1]!.secret),
        ]);
      }
      let after = await view(code, seats[0]!.secret);
      let peer = await view(code, seats[1]!.secret);
      if (peer.stage !== after.stage) {
        after = await view(code, seats[0]!.secret);
        peer = await view(code, seats[1]!.secret);
      }
      expect(after.stage).toBeGreaterThanOrEqual(stage);
      expect(Math.abs(peer.stage - after.stage)).toBeLessThanOrEqual(1);
      record(after);
    }
    expect(seen[seen.length - 1]).toBe(10);
    for (let index = 1; index < seen.length; index++) expect(seen[index]!).toBeGreaterThanOrEqual(seen[index - 1]!);
    expect(await duplicateEvents(code)).toEqual([]);
    const hostFinal = await view(code, seats[0]!.secret);
    const guestFinal = await view(code, seats[1]!.secret);
    expect(hostFinal.stage).toBe(10);
    expect(guestFinal.stage).toBe(10);
  }, 180_000);

  it('scopes rematch event keys to the new league', async () => {
    const { code, seats } = await seasonLeague();
    const row = await lobbyRow(code);
    await db().query(
      "insert into events (lobby_id, kind, payload) values ($1::uuid, 'awards', jsonb_build_object('detail', 'old', 'key', '4:awards'))",
      [row.id],
    );
    await db().query("update lobbies set rematch = 1, stage = 4, phase = 'awards', stage_cursor = 0, stage_started_at = null where id = $1::uuid", [row.id]);
    await view(code, seats[0]!.secret);
    expect((await eventsOfKind(code, 'awards')).some((entry) => entry.key === '1:4:awards')).toBe(true);

    await db().query(
      "insert into events (lobby_id, kind, payload) values ($1::uuid, 'playoff_start', jsonb_build_object('detail', 'old', 'key', '6:start'))",
      [row.id],
    );
    await db().query("update lobbies set stage = 6, phase = 'playoffs', stage_cursor = 0, stage_started_at = null where id = $1::uuid", [row.id]);
    expect((await advance(code, seats[0]!.secret, 6)).status).toBe(200);
    expect((await eventsOfKind(code, 'playoff_start')).some((entry) => entry.key === '1:6:start')).toBe(true);

    await db().query(
      "insert into events (lobby_id, kind, payload) values ($1::uuid, 'champion', jsonb_build_object('detail', 'old', 'key', '9:champion'))",
      [row.id],
    );
    await db().query("update lobbies set stage = 9, phase = 'playoffs', stage_cursor = 100000, stage_started_at = now() - interval '1 hour' where id = $1::uuid", [row.id]);
    await view(code, seats[0]!.secret);
    expect((await eventsOfKind(code, 'champion')).some((entry) => entry.key === '1:9:champion')).toBe(true);
  }, 120_000);

  it('prints the winner score first and attributes play-in lines to the human', async () => {
    const clock = {
      humanSeasons: [{ participantId: 'p1', name: 'Fay', team: 'POR', wins: 40, losses: 42, seed: 8 }],
      qualified: ['POR', 'LAC'],
      series: [{ round: 1, name: 'First Round', high: 'LAC', low: 'POR', winner: 'POR', wins: 2, losses: 4, games: [] }],
      playinGames: [{ conference: 'west', label: 'Last spot', home: 'POR', away: 'LAC', winner: 'LAC' }],
    } as unknown as LeagueClock;
    const series = stageEvents(6, clock).find((entry) => entry.kind === 'series_result');
    expect(series?.detail).toBe('beat LAC 4-2 in the First Round');
    const playin = stageEvents(5, clock).find((entry) => entry.kind === 'playin_result');
    expect(playin?.detail).toBe('lost to LAC in the Last spot play-in');
  });

  it('routes a host advance from the play-in into the playoff gate', async () => {
    const { code, seats } = await seasonLeague();
    const row = await lobbyRow(code);
    const qualified = [...new Set(row.league.series.filter((series) => series.round === 1).flatMap((series) => [series.high, series.low]))];
    const nonQualified = row.league.standings.east.concat(row.league.standings.west).map((entry) => entry.team).filter((team) => !qualified.includes(team));
    await setTeams(code, [qualified[0]!, nonQualified[0]!]);
    await setStage(code, 5, 'playin', 100000);
    expect((await advance(code, seats[0]!.secret, 5)).status).toBe(200);
    const lobby = await view(code, seats[0]!.secret);
    expect(lobby.stage).toBe(6);
    expect(lobby.gate).not.toBeNull();
  }, 120_000);

  it('starts the gate once under concurrent polls', async () => {
    const { code, seats } = await seasonLeague();
    const row = await lobbyRow(code);
    const qualified = new Set(row.league.series.filter((series) => series.round === 1).flatMap((series) => [series.high, series.low]));
    const nonQualified = row.league.standings.east.concat(row.league.standings.west).map((entry) => entry.team).filter((team) => !qualified.has(team));
    await setTeams(code, [nonQualified[0]!, nonQualified[1]!]);
    await setStage(code, 6, 'playoffs', 0);
    await Promise.all([
      view(code, seats[0]!.secret),
      view(code, seats[1]!.secret),
      view(code, seats[0]!.secret),
      advance(code, seats[0]!.secret, 6),
      advance(code, seats[0]!.secret, 6),
    ]);
    expect(await eventsOfKind(code, 'playoff_start')).toHaveLength(1);
  }, 120_000);

  it('treats a repeated host start as the current state', async () => {
    const { code, seats } = await seasonLeague();
    const row = await lobbyRow(code);
    const qualified = [...new Set(row.league.series.filter((series) => series.round === 1).flatMap((series) => [series.high, series.low]))];
    const nonQualified = row.league.standings.east.concat(row.league.standings.west).map((entry) => entry.team).filter((team) => !qualified.includes(team));
    await setTeams(code, [qualified[0]!, nonQualified[0]!]);
    await setStage(code, 6, 'playoffs', 0);
    expect((await advance(code, seats[0]!.secret, 6)).status).toBe(200);
    const started = await view(code, seats[0]!.secret);
    expect(started.stage).toBe(6);
    expect(started.league?.cursor).toBeLessThan(started.league?.stageTotal ?? 0);
    expect(started.league?.checkpoint).toBe(false);
    expect((await advance(code, seats[0]!.secret, 6)).status).toBe(200);
    expect(await eventsOfKind(code, 'playoff_start')).toHaveLength(1);
    expect((await view(code, seats[0]!.secret)).gate).toBeNull();
  }, 120_000);

  it('treats a host advance during a reveal as the current state', async () => {
    const { code, seats } = await seasonLeague();
    await setStage(code, 7, 'playoffs', 0);
    await db().query('update lobbies set stage_started_at = now() where code = $1', [code]);
    expect((await advance(code, seats[0]!.secret, 7)).status).toBe(200);
    const lobby = await view(code, seats[0]!.secret);
    expect(lobby.stage).toBe(7);
    expect(lobby.league?.cursor).toBeLessThan(lobby.league?.stageTotal ?? 0);
  }, 120_000);

  it('names every waiting player and the host in the gate action', async () => {
    const { code, seats } = await seasonLeague(4);
    const row = await lobbyRow(code);
    const qualified = [...new Set(row.league.series.filter((series) => series.round === 1).flatMap((series) => [series.high, series.low]))];
    await setTeams(code, qualified.slice(0, 4));
    await setStage(code, 6, 'playoffs', 0);
    const host = await view(code, seats[0]!.secret);
    const guest = await view(code, seats[1]!.secret);
    expect(host.gate?.nextAction).toContain('Start the playoffs');
    expect(guest.gate?.nextAction).toContain('Host can start');
    for (const name of ['Host', 'P2', 'P3', 'P4']) {
      expect(host.gate?.nextAction).toContain(name);
      expect(guest.gate?.nextAction).toContain(name);
    }
  }, 120_000);

  it('answers a waiting gate poll without a full read', async () => {
    const { code, seats } = await seasonLeague();
    const row = await lobbyRow(code);
    const qualified = [...new Set(row.league.series.filter((series) => series.round === 1).flatMap((series) => [series.high, series.low]))];
    const nonQualified = row.league.standings.east.concat(row.league.standings.west).map((entry) => entry.team).filter((team) => !qualified.includes(team));
    await setTeams(code, [qualified[0]!, nonQualified[0]!]);
    await setStage(code, 6, 'playoffs', 0);
    const lobby = await view(code, seats[0]!.secret);
    const token = progressToken(lobby);
    const events = lobby.events[0]?.id ?? 0;
    const response = await viewHandler(
      new Request(`${BASE}/lobby/${code}?since=${lobby.version}&events=${events}&token=${encodeURIComponent(token)}&waiting=1`, {
        headers: { authorization: `Bearer ${seats[0]!.secret}` },
      }),
    );
    expect(response.status).toBe(204);
  }, 120_000);

  it('hides the gate when no human is qualified', () => {
    const participant: RawParticipant = {
      id: 'p1',
      name: 'Ava',
      seat: 1,
      status: 'joined',
      joined_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      is_me: true,
      build: null,
      build_kind: null,
      build_summary: null,
      ready_stage: 0,
      preview_ready: false,
      team: 'BKN',
      reroll_used: false,
      salary_powers: null,
    };
    expect(gateViewFor([participant], { checkpoint: true, playoffs: [{ round: 1, high: 'BOS', low: 'NYK' }] }, 'p1', 'p1', 'playoffs', 6, Date.now())).toBeNull();
  });

  it('logs every human in shared play-in and series games and every missed playoff team', () => {
    const clock = {
      humanSeasons: [
        { participantId: 'a', name: 'Ava', team: 'POR', wins: 40, losses: 42, seed: 10 },
        { participantId: 'b', name: 'Ben', team: 'LAC', wins: 41, losses: 41, seed: 8 },
        { participantId: 'c', name: 'Cara', team: 'PHX', wins: 35, losses: 47, seed: 12 },
      ],
      qualified: ['LAC'],
      playinGames: [{ conference: 'west', label: 'Last spot', home: 'POR', away: 'LAC', winner: 'LAC' }],
      series: [{ round: 1, name: 'First Round', high: 'POR', low: 'LAC', winner: 'LAC', wins: 2, losses: 4, games: [] }],
      champion: 'LAC',
    } as unknown as LeagueClock;
    const playin = stageEvents(5, clock).filter((entry) => entry.kind === 'playin_result');
    expect(playin).toHaveLength(2);
    expect(playin.map((entry) => entry.detail)).toEqual(['lost to LAC in the Last spot play-in', 'beat POR in the Last spot play-in']);
    expect(stageEvents(4, clock).filter((entry) => entry.kind === 'elimination' && entry.detail?.includes('PHX'))).toHaveLength(1);
    const series = stageEvents(6, clock).filter((entry) => entry.kind === 'series_result');
    expect(series).toHaveLength(2);
    const finals = { ...clock, series: [{ round: 4, name: 'NBA Finals', high: 'POR', low: 'LAC', winner: 'LAC', wins: 2, losses: 4, games: [] }] } as unknown as LeagueClock;
    expect(stageEvents(9, finals).filter((entry) => entry.kind === 'advance')).toHaveLength(0);
    expect(stageEvents(9, finals).filter((entry) => entry.kind === 'champion')).toHaveLength(1);
  });
});
