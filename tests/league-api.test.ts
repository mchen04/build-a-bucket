import { afterAll, describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { POST as createHandler } from '../api/lobby/index';
import { GET as viewHandler } from '../api/lobby/[code]/index';
import {
  advanceAction as advanceHandler,
  buildAction as buildHandler,
  drawAction as drawHandler,
  joinAction as joinHandler,
  leaveAction,
  lockAction as lockHandler,
  powerAction as powerHandler,
  readyAction as readyHandler,
  rematchAction as rematchHandler,
  removeAction as removeHandler,
  rerollAction as rerollHandler,
  startAction as startHandler,
} from '../src/server/actions';
import { loadLocalEnv } from '../scripts/lib.ts';
import { db } from '../src/server/db';
import { computeLeagueFor, unchangedPoll } from '../src/server/lobby';
import { loadCatalog, poolFor } from '../src/shared/data/loader';
import { BIG_ATTRS, GUARD_ATTRS } from '../src/shared/engine/rules';
import { spinTarget, type SpinRecord } from '../src/shared/engine/spin';
import type { LeagueResult } from '../src/shared/engine/league';
import type { Era, Pick, Position } from '../src/shared/engine/types';
import { generateSecret, newActionId, normalizeCode } from '../src/shared/mp/codes';
import { stageTotal } from '../src/shared/mp/league';
import { progressToken } from '../src/shared/mp/progress';
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

function pollWith(secret: string, code: string, since: number, token: string, events: number, waiting = true): Request {
  const query = new URLSearchParams({ since: String(since), events: String(events), token });
  if (waiting) query.set('waiting', '1');
  return new Request(`${BASE}/lobby/${code}?${query.toString()}`, { headers: { authorization: `Bearer ${secret}` } });
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

async function start(code: string, secret: string, settings: LobbySettings): Promise<Response> {
  return startHandler(authed(secret, `lobby/${code}/start`, { actionId: newActionId(), settings }));
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

async function submit(code: string, secret: string, build: LobbyBuild): Promise<Response> {
  return buildHandler(authed(secret, `lobby/${code}/build`, { actionId: newActionId(), build }));
}

async function submitOk(code: string, secret: string, build: LobbyBuild): Promise<void> {
  const response = await submit(code, secret, build);
  expect(response.status).toBe(200);
}

async function ready(code: string, secret: string, stage: number): Promise<void> {
  const response = await readyHandler(authed(secret, `lobby/${code}/ready`, { actionId: newActionId(), stage }));
  expect(response.status).toBe(200);
}

async function advance(code: string, secret: string, stage: number, actionId = newActionId()): Promise<Response> {
  return advanceHandler(authed(secret, `lobby/${code}/advance`, { actionId, stage }));
}

async function rematch(code: string, secret: string): Promise<Response> {
  return rematchHandler(authed(secret, `lobby/${code}/rematch`, { actionId: newActionId() }));
}

async function power(
  code: string,
  secret: string,
  kind: 'shuffle' | 'scout',
  target: { kind: 'column'; index: number } | { kind: 'row'; tier: number } | { cardId: string },
): Promise<LobbyView> {
  const response = await powerHandler(authed(secret, `lobby/${code}/power`, { actionId: newActionId(), power: kind, target }));
  expect(response.status).toBe(200);
  return (await read<{ lobby: LobbyView }>(response)).lobby;
}

async function remove(code: string, secret: string, seat: number): Promise<Response> {
  return removeHandler(authed(secret, `lobby/${code}/remove`, { actionId: newActionId(), seat }));
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

async function spunBuild(seed: string, position: Position, era: Era, strategy: 'high' | 'low'): Promise<NormalBuild> {
  const catalog = await loadCatalog();
  const pool = poolFor(catalog, position, era);
  const keys: readonly string[] = position === 'guard' ? GUARD_ATTRS : BIG_ATTRS;
  const picks: Record<string, Pick> = {};
  const spins: SpinRecord[] = [];
  const filled = new Set<string>();
  for (let index = 0; index < keys.length; index++) {
    const target = spinTarget(pool, seed, index, false, 0, `${seed}:r`);
    if (!target) throw new Error('no spin target');
    const open = keys
      .filter((attr) => !filled.has(attr) && target.player.attrs[attr] !== undefined)
      .sort((a, b) => (target.player.attrs[b] ?? 0) - (target.player.attrs[a] ?? 0));
    const attr = strategy === 'high' ? open[0] : open[open.length - 1];
    if (!attr) throw new Error(`no open ${position} trait`);
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
  return { kind: 'normal', position, era, picks, spins };
}

function salaryBuild(lobby: LobbyView, expensive = false): SalaryBuild {
  const board = lobby.salaryBoard;
  if (!board) throw new Error('salary board missing');
  const cards: SalaryCardPick[] = board.map((column) => {
    const ranked = [...column].sort((a, b) => (expensive ? b.price - a.price : a.price - b.price));
    const card = ranked[0];
    if (!card) throw new Error('empty salary column');
    return card;
  });
  return { kind: 'salary', position: cards[4]?.posGroup ?? 'guard', cards };
}

async function squadBuild(seed: string, era: Era): Promise<SquadBuild> {
  const slots: { slot: string; position: Position }[] = [
    { slot: 'PG', position: 'guard' },
    { slot: 'SG', position: 'guard' },
    { slot: 'SF', position: 'guard' },
    { slot: 'PF', position: 'big' },
    { slot: 'C', position: 'big' },
  ];
  const players = [];
  for (const entry of slots) {
    const build = await spunBuild(`${seed}:${entry.slot}`, entry.position, era, 'high');
    players.push({ slot: entry.slot, position: entry.position, picks: build.picks, spins: build.spins });
  }
  return { kind: 'squad', players };
}

async function buildFor(mode: LobbySettings['mode'], lobby: LobbyView, index: number): Promise<LobbyBuild> {
  const seed = lobby.me.buildSeed;
  if (!seed) throw new Error('missing build seed');
  if (mode === 'normal') return spunBuild(seed, index % 2 === 0 ? 'guard' : 'big', lobby.settings.era, index % 3 === 0 ? 'low' : 'high');
  if (mode === 'salary') return salaryBuild(lobby);
  return squadBuild(seed, lobby.settings.era);
}

async function setupBuilding(mode: LobbySettings['mode'], players: number): Promise<{ code: string; seats: Seat[] }> {
  const settings: LobbySettings = { era: 'current', mode };
  const host = await createLobby('Host', settings);
  const seats: Seat[] = [host.host];
  for (let index = 2; index <= players; index++) seats.push(await join(host.code, `P${index}`));
  const started = await start(host.code, host.host.secret, settings);
  expect(started.status).toBe(200);
  await Promise.all(seats.map((seat) => draw(host.code, seat.secret)));
  await lock(host.code, host.host.secret);
  return { code: host.code, seats };
}

async function runLeague(
  mode: LobbySettings['mode'],
  players = 8,
  era: LobbySettings['era'] = 'current',
): Promise<{ code: string; seats: Seat[]; view: LobbyView }> {
  const settings: LobbySettings = { era, mode };
  const host = await createLobby('Host', settings);
  const seats: Seat[] = [host.host];
  for (let index = 2; index <= players; index++) seats.push(await join(host.code, `P${index}`));
  expect((await start(host.code, host.host.secret, settings)).status).toBe(200);
  await Promise.all(seats.map((seat) => draw(host.code, seat.secret)));
  await lock(host.code, host.host.secret);
  for (let index = 0; index < seats.length; index++) {
    const seat = seats[index] as Seat;
    const lobby = await view(host.code, seat.secret);
    if (mode === 'salary' && index === 0) expect(v.safeParse(LobbyEnvelopeSchema, { lobby }).success).toBe(true);
    await submitOk(host.code, seat.secret, await buildFor(mode, lobby, index));
  }
  for (const seat of seats) await ready(host.code, seat.secret, 0);
  let lobby = await view(host.code, host.host.secret);
  expect(lobby.phase).toBe('season');
  expect(lobby.league?.games.length ?? 0).toBeLessThanOrEqual(30);
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
    expect(recap.league?.recap?.entries).toHaveLength(8);
  }, 180_000);

  it('runs a complete 8-player salary league to recap', async () => {
    const { view: recap } = await runLeague('salary');
    expect(recap.league?.recap?.champion).toBeTruthy();
    expect(recap.league?.awards).not.toBeNull();
  }, 180_000);

  it('runs a complete 8-player squad league to recap', async () => {
    const { view: recap } = await runLeague('squad');
    expect(recap.league?.recap?.champion).toBeTruthy();
    expect(recap.league?.awards).not.toBeNull();
  }, 180_000);

  it('runs the normal all-time board to recap', async () => {
    const { view: recap } = await runLeague('normal', 2, 'alltime');
    expect(recap.league?.recap?.champion).toBeTruthy();
    expect(recap.league?.awards).not.toBeNull();
  }, 120_000);

  it('runs the salary all-time board to recap', async () => {
    const { view: recap } = await runLeague('salary', 2, 'alltime');
    expect(recap.league?.recap?.champion).toBeTruthy();
    expect(recap.league?.awards).not.toBeNull();
  }, 120_000);

  it('runs the squad all-time board to recap', async () => {
    const { view: recap } = await runLeague('squad', 2, 'alltime');
    expect(recap.league?.recap?.champion).toBeTruthy();
    expect(recap.league?.awards).not.toBeNull();
  }, 120_000);

  it('rejects an advance after the recap without changing the result', async () => {
    const { code, seats, view: recap } = await runLeague('normal', 2);
    const response = await advance(code, seats[0]!.secret, recap.stage);
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('not at a checkpoint');
    const after = await view(code, seats[0]!.secret);
    expect(after.phase).toBe('recap');
    expect(after.stage).toBe(recap.stage);
    expect(after.league?.cursor).toBe(recap.league?.cursor);
    expect(after.league?.recap?.champion).toBe(recap.league?.recap?.champion);
  }, 120_000);

  it('needs at least two players to start', async () => {
    const settings: LobbySettings = { era: 'current', mode: 'normal' };
    const host = await createLobby('Host', settings);
    expect((await start(host.code, host.host.secret, settings)).status).toBe(409);
    await join(host.code, 'Guest');
    expect((await start(host.code, host.host.secret, settings)).status).toBe(200);
  }, 60_000);

  it('draws a team for a player who never drew when the host locks', async () => {
    const settings: LobbySettings = { era: 'current', mode: 'normal' };
    const host = await createLobby('Host', settings);
    const guest = await join(host.code, 'Guest');
    expect((await start(host.code, host.host.secret, settings)).status).toBe(200);
    await draw(host.code, host.host.secret);
    await lock(host.code, host.host.secret);
    const lobby = await view(host.code, guest.secret);
    expect(lobby.phase).toBe('building');
    expect(lobby.teams).toHaveLength(2);
    expect(new Set(lobby.teams.map((entry) => entry.team)).size).toBe(2);
    expect(lobby.me.team).toBeTruthy();
    await submitOk(host.code, guest.secret, await buildFor('normal', lobby, 1));
  }, 60_000);

  it('lets a concurrent join and lock leave every retained player with a team', async () => {
    const settings: LobbySettings = { era: 'current', mode: 'normal' };
    const host = await createLobby('Host', settings);
    const guest = await join(host.code, 'Guest');
    expect((await start(host.code, host.host.secret, settings)).status).toBe(200);
    await draw(host.code, host.host.secret);
    const lateSecret = generateSecret();
    const late = joinHandler(authed(lateSecret, `lobby/${host.code}/join`, { name: 'Late', actionId: newActionId() }));
    const locking = lockHandler(authed(host.host.secret, `lobby/${host.code}/lock`, { actionId: newActionId() }));
    await Promise.all([late, locking]);
    const lobby = await view(host.code, guest.secret);
    expect(lobby.phase).toBe('building');
    expect(lobby.teams).toHaveLength(lobby.participants.filter((entry) => entry.status !== 'left').length);
    expect(lobby.participants.every((entry) => entry.status !== 'left' ? Boolean(entry.team) : true)).toBe(true);
  }, 60_000);

  it('advances a checkpoint once under concurrent advances', async () => {
    const { code, seats } = await setupBuilding('normal', 4);
    for (let index = 0; index < seats.length; index++) {
      const seat = seats[index] as Seat;
      const lobby = await view(code, seat.secret);
      await submitOk(code, seat.secret, await buildFor('normal', lobby, index));
    }
    for (const seat of seats) await ready(code, seat.secret, 0);
    await fastForward(code);
    const before = await view(code, seats[0]!.secret);
    await Promise.all(Array.from({ length: 5 }, () => advance(code, seats[0]!.secret, before.stage)));
    const after = await view(code, seats[0]!.secret);
    expect(after.stage).toBe(before.stage + 1);
    expect((await advance(code, seats[0]!.secret, before.stage)).status).toBe(200);
    expect((await view(code, seats[0]!.secret)).stage).toBe(after.stage);
  }, 60_000);

  it('rejects builds the server spin sequence could not produce', async () => {
    const { code, seats } = await setupBuilding('normal', 2);
    const lobby = await view(code, seats[1]!.secret);
    const forged = await spunBuild('not-the-server-seed', 'guard', 'current', 'high');
    expect((await submit(code, seats[1]!.secret, forged)).status).toBe(400);
    await submitOk(code, seats[1]!.secret, await buildFor('normal', lobby, 1));
  }, 60_000);

  it('writes a build once under concurrent submissions', async () => {
    const { code, seats } = await setupBuilding('normal', 2);
    const lobby = await view(code, seats[1]!.secret);
    const build = await buildFor('normal', lobby, 1);
    const [first, second] = await Promise.all([
      submit(code, seats[1]!.secret, build),
      submit(code, seats[1]!.secret, build),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const after = await view(code, seats[1]!.secret);
    expect(after.me.summary?.filled).toBe(10);
    expect(after.me.status).toBe('ready');
  }, 60_000);

  it('rejects a squad slot that does not match its position', async () => {
    const { code, seats } = await setupBuilding('squad', 2);
    const lobby = await view(code, seats[1]!.secret);
    const seed = lobby.me.buildSeed;
    if (!seed) throw new Error('missing seed');
    const build = await squadBuild(seed, 'current');
    build.players[0] = { ...build.players[0]!, position: 'big' };
    expect((await submit(code, seats[1]!.secret, build)).status).toBe(400);
    await submitOk(code, seats[1]!.secret, await squadBuild(seed, 'current'));
  }, 60_000);

  it('rejects salary cards outside the board and over the cap', async () => {
    const { code, seats } = await setupBuilding('salary', 2);
    const lobby = await view(code, seats[1]!.secret);
    const board = lobby.salaryBoard;
    if (!board) throw new Error('missing board');
    const valid = salaryBuild(lobby);
    const foreign: SalaryBuild = { ...valid, cards: valid.cards.map((card) => ({ ...card, id: `${card.id}-nope` })) };
    expect((await submit(code, seats[1]!.secret, foreign)).status).toBe(400);
    const expensive = salaryBuild(lobby, true);
    if (expensive.cards.reduce((sum, card) => sum + card.price, 0) > (lobby.salaryBudget ?? 0)) {
      expect((await submit(code, seats[1]!.secret, expensive)).status).toBe(400);
    }
    await submitOk(code, seats[1]!.secret, valid);
  }, 60_000);

  it('keeps salary powers per participant, idempotent and persisted', async () => {
    const { code, seats } = await setupBuilding('salary', 2);
    const first = await view(code, seats[0]!.secret);
    const second = await view(code, seats[1]!.secret);
    const before = JSON.stringify(first.salaryBoard);
    const shuffled = await power(code, seats[0]!.secret, 'shuffle', { kind: 'column', index: 0 });
    expect(shuffled.salaryPowers?.shuffle).toBe(true);
    expect(JSON.stringify(shuffled.salaryBoard)).not.toBe(before);
    const retried = await power(code, seats[0]!.secret, 'shuffle', { kind: 'column', index: 1 });
    expect(retried.salaryPowers?.shuffle).toBe(true);
    expect(JSON.stringify(retried.salaryBoard)).toBe(JSON.stringify(shuffled.salaryBoard));
    const reconnected = await view(code, seats[0]!.secret);
    expect(JSON.stringify(reconnected.salaryBoard)).toBe(JSON.stringify(shuffled.salaryBoard));
    const other = await view(code, seats[1]!.secret);
    expect(JSON.stringify(other.salaryBoard)).toBe(JSON.stringify(second.salaryBoard));
    const card = reconnected.salaryBoard?.[2]?.[0];
    if (!card) throw new Error('missing card');
    const scouted = await power(code, seats[0]!.secret, 'scout', { cardId: card.id });
    expect(scouted.salaryPowers?.scout).toBe(true);
    expect(scouted.salaryPowers?.scouted[card.id]).toBeTruthy();
    await submitOk(code, seats[0]!.secret, salaryBuild(reconnected));
  }, 60_000);

  it('auto-completes missing builds when the host locks now', async () => {
    const { code, seats } = await setupBuilding('normal', 3);
    const first = await view(code, seats[0]!.secret);
    await submitOk(code, seats[0]!.secret, await buildFor('normal', first, 0));
    const response = await advance(code, seats[0]!.secret, 0);
    expect(response.status).toBe(200);
    const preview = await view(code, seats[0]!.secret);
    expect(preview.phase).toBe('preview');
    const missing = preview.participants.filter((entry) => entry.seat !== seats[0]!.seat);
    expect(missing.every((entry) => entry.summary?.auto === true)).toBe(true);
    for (const seat of seats) await ready(code, seat.secret, 0);
    const season = await view(code, seats[0]!.secret);
    expect(season.phase).toBe('season');
    expect(season.league?.recap).toBeNull();
    expect(season.participants.every((entry) => entry.summary !== null)).toBe(true);
  }, 60_000);

  it('rejoins the same seat after leaving once the draw is over', async () => {
    const { code, seats } = await setupBuilding('normal', 2);
    const guest = seats[1] as Seat;
    const leave = leaveAction;
    const response = await leave(authed(guest.secret, `lobby/${code}/leave`, { actionId: newActionId() }));
    expect(response.status).toBe(200);
    const left = await view(code, seats[0]!.secret);
    expect(left.participants.find((entry) => entry.seat === guest.seat)?.status).toBe('left');
    const rejoined = await joinHandler(authed(guest.secret, `lobby/${code}/join`, { name: 'Guest', actionId: newActionId() }));
    expect(rejoined.status).toBe(200);
    const back = (await read<{ lobby: LobbyView }>(rejoined)).lobby;
    expect(back.me.seat).toBe(guest.seat);
    expect(back.me.status).toBe('joined');
  }, 60_000);

  it('rematches only after every retained player readies, with a new seed', async () => {
    const { code, seats } = await runLeague('normal', 2);
    const before = await db().query<{ season_secret: string; rematch: number }>(
      'select season_secret, rematch from lobbies where code = $1',
      [code],
    );
    const first = await rematch(code, seats[0]!.secret);
    expect(first.status).toBe(200);
    const pending = (await read<{ lobby: LobbyView }>(first)).lobby;
    expect(pending.phase).toBe('rematch');
    expect(pending.teams).toHaveLength(0);
    expect(pending.league).toBeNull();
    expect(pending.participants.every((entry) => entry.ready === false)).toBe(true);
    const after = await db().query<{ season_secret: string; rematch: number }>(
      'select season_secret, rematch from lobbies where code = $1',
      [code],
    );
    expect(after[0]?.season_secret).not.toBe(before[0]?.season_secret);
    expect(after[0]?.rematch).toBe((before[0]?.rematch ?? 0) + 1);
    expect((await advance(code, seats[0]!.secret, 0)).status).toBe(409);
    await ready(code, seats[0]!.secret, 0);
    expect((await advance(code, seats[0]!.secret, 0)).status).toBe(409);
    await ready(code, seats[1]!.secret, 0);
    const next = await view(code, seats[0]!.secret);
    expect(next.phase).toBe('draw');
    const second = await rematch(code, seats[1]!.secret);
    expect(second.status).toBe(403);
    const firstDraw = await draw(code, seats[0]!.secret);
    expect(firstDraw.teams.find((entry) => entry.seat === seats[0]!.seat)?.rerollUsed).toBe(false);
    const rerolled = await reroll(code, seats[0]!.secret);
    expect(rerolled.teams.find((entry) => entry.seat === seats[0]!.seat)?.rerollUsed).toBe(true);
    await draw(code, seats[1]!.secret);
  }, 120_000);

  it('does not count a departed player against the rematch gate', async () => {
    const { code, seats } = await runLeague('normal', 2);
    expect((await rematch(code, seats[0]!.secret)).status).toBe(200);
    const leave = leaveAction;
    expect((await leave(authed(seats[1]!.secret, `lobby/${code}/leave`, { actionId: newActionId() }))).status).toBe(200);
    await ready(code, seats[0]!.secret, 0);
    const drawn = await advance(code, seats[0]!.secret, 0);
    expect(drawn.status).toBe(409);
    const lobby = await view(code, seats[0]!.secret);
    expect(lobby.phase).toBe('rematch');
    expect(lobby.seatsTaken).toBe(1);
  }, 120_000);

  it('lets the host remove an away participant and open the rematch draw', async () => {
    const { code, seats } = await runLeague('normal', 3);
    expect((await rematch(code, seats[0]!.secret)).status).toBe(200);
    await db().query(
      "update participants set last_seen = now() - interval '2 minutes' where lobby_id = (select id from lobbies where code = $1) and seat = $2",
      [code, seats[2]!.seat],
    );
    const removed = await remove(code, seats[0]!.secret, seats[2]!.seat);
    expect(removed.status).toBe(200);
    const afterRemove = (await read<{ lobby: LobbyView }>(removed)).lobby;
    expect(afterRemove.participants.find((entry) => entry.seat === seats[2]!.seat)?.status).toBe('left');
    await ready(code, seats[0]!.secret, 0);
    await ready(code, seats[1]!.secret, 0);
    expect((await advance(code, seats[0]!.secret, 0)).status).toBe(200);
    expect((await view(code, seats[0]!.secret)).phase).toBe('draw');
  }, 120_000);

  it('reports the minimum-player outcome when an away removal leaves one player', async () => {
    const { code, seats } = await runLeague('normal', 2);
    expect((await rematch(code, seats[0]!.secret)).status).toBe(200);
    await db().query(
      "update participants set last_seen = now() - interval '2 minutes' where lobby_id = (select id from lobbies where code = $1) and seat = $2",
      [code, seats[1]!.seat],
    );
    expect((await remove(code, seats[0]!.secret, seats[1]!.seat)).status).toBe(200);
    const lobby = await view(code, seats[0]!.secret);
    expect(lobby.participants.filter((entry) => entry.status !== 'left')).toHaveLength(1);
    const outcome = await advance(code, seats[0]!.secret, 0);
    expect(outcome.status).toBe(409);
    expect((await read<{ error: string }>(outcome)).error).toContain('at least 2 players');
  }, 120_000);

  it('gives every rematch a new seed and resets the team respin', async () => {
    const { code, seats } = await runLeague('normal', 2);
    const first = await db().query<{ season_secret: string; league: unknown }>(
      'select season_secret, league from lobbies where code = $1',
      [code],
    );
    const firstSecret = first[0]?.season_secret;
    const league = first[0]?.league;
    expect((await rematch(code, seats[0]!.secret)).status).toBe(200);
    const second = await db().query<{ season_secret: string }>('select season_secret from lobbies where code = $1', [code]);
    expect(second[0]?.season_secret).not.toBe(firstSecret);
    await ready(code, seats[0]!.secret, 0);
    await ready(code, seats[1]!.secret, 0);
    expect((await view(code, seats[0]!.secret)).phase).toBe('draw');
    await draw(code, seats[0]!.secret);
    const rerolled = await reroll(code, seats[0]!.secret);
    expect(rerolled.teams.find((entry) => entry.seat === seats[0]!.seat)?.rerollUsed).toBe(true);
    await draw(code, seats[1]!.secret);
    await db().query("update lobbies set phase = 'recap', league = $2::jsonb where code = $1", [code, JSON.stringify(league)]);
    expect((await rematch(code, seats[0]!.secret)).status).toBe(200);
    const third = await db().query<{ season_secret: string }>('select season_secret from lobbies where code = $1', [code]);
    expect(third[0]?.season_secret).not.toBe(second[0]?.season_secret);
    await ready(code, seats[0]!.secret, 0);
    await ready(code, seats[1]!.secret, 0);
    expect((await view(code, seats[0]!.secret)).phase).toBe('draw');
    const drawn = await draw(code, seats[0]!.secret);
    expect(drawn.teams.find((entry) => entry.seat === seats[0]!.seat)?.rerollUsed).toBe(false);
    await draw(code, seats[1]!.secret);
  }, 120_000);

  it('consumes the team respin once under concurrent rerolls and keeps it after a reload', async () => {
    const { code, seats } = await runLeague('normal', 2);
    expect((await rematch(code, seats[0]!.secret)).status).toBe(200);
    await ready(code, seats[0]!.secret, 0);
    await ready(code, seats[1]!.secret, 0);
    await draw(code, seats[0]!.secret);
    const [a, b] = await Promise.all([reroll(code, seats[0]!.secret), reroll(code, seats[0]!.secret)]);
    const mine = (lobby: LobbyView) => lobby.teams.find((entry) => entry.seat === seats[0]!.seat);
    expect(mine(a)?.rerollUsed).toBe(true);
    expect(mine(b)?.rerollUsed).toBe(true);
    expect(mine(a)?.team).toBe(mine(b)?.team);
    const reloaded = await view(code, seats[0]!.secret);
    expect(mine(reloaded)?.team).toBe(mine(a)?.team);
    expect(mine(reloaded)?.rerollUsed).toBe(true);
    const again = await reroll(code, seats[0]!.secret);
    expect(mine(again)?.team).toBe(mine(a)?.team);
    await draw(code, seats[1]!.secret);
  }, 120_000);

  it('lets the host remove an away player so the group is never trapped', async () => {
    const { code, seats } = await setupBuilding('normal', 2);
    await db().query(
      "update participants set last_seen = now() - interval '10 minutes' where lobby_id = (select id from lobbies where code = $1) and seat = $2",
      [code, seats[1]!.seat],
    );
    const response = await remove(code, seats[0]!.secret, seats[1]!.seat);
    expect(response.status).toBe(200);
    const lobby = (await read<{ lobby: LobbyView }>(response)).lobby;
    expect(lobby.participants.find((entry) => entry.seat === seats[1]!.seat)?.status).toBe('left');
    expect((await remove(code, seats[0]!.secret, seats[0]!.seat)).status).toBe(400);
  }, 60_000);

  it('reports full, started and missing lobbies on join', async () => {
    const settings: LobbySettings = { era: 'current', mode: 'normal' };
    const host = await createLobby('Host', settings);
    for (let index = 2; index <= 8; index++) await join(host.code, `P${index}`);
    const fullSecret = generateSecret();
    const full = await joinHandler(authed(fullSecret, `lobby/${host.code}/join`, { name: 'Ninth', actionId: newActionId() }));
    expect(full.status).toBe(409);
    expect((await read<{ reason: string }>(full)).reason).toBe('full');
    expect((await start(host.code, host.host.secret, settings)).status).toBe(200);
    const lateSecret = generateSecret();
    const late = await joinHandler(authed(lateSecret, `lobby/${normalizeCode(host.code)}/join`, { name: 'Late', actionId: newActionId() }));
    expect(late.status).toBe(409);
    expect((await read<{ reason: string }>(late)).reason).toBe('started');
    const missing = await joinHandler(authed(generateSecret(), 'lobby/ZZZZZZ/join', { name: 'Nobody', actionId: newActionId() }));
    expect(missing.status).toBe(404);
    expect((await read<{ reason: string }>(missing)).reason).toBe('not_found');
  }, 60_000);

  it('answers 204 for an unchanged poll and refreshes the seat heartbeat', async () => {
    const settings: LobbySettings = { era: 'current', mode: 'normal' };
    const host = await createLobby('Host', settings);
    await join(host.code, 'Guest');
    const lobby = await view(host.code, host.host.secret);
    const token = progressToken(lobby);
    const events = lobby.events[0]?.id ?? 0;
    await db().query(
      "update participants set last_seen = now() - interval '30 seconds' where lobby_id = (select id from lobbies where code = $1) and seat = $2",
      [host.code, host.host.seat],
    );
    const response = await viewHandler(pollWith(host.host.secret, host.code, lobby.version, token, events));
    expect(response.status).toBe(204);
    const rows = await db().query<{ fresh: boolean }>(
      "select last_seen > now() - interval '5 seconds' as fresh from participants where lobby_id = (select id from lobbies where code = $1) and seat = $2",
      [host.code, host.host.seat],
    );
    expect(rows[0]?.fresh).toBe(true);
  }, 60_000);

  it('returns the change when the lobby starts and rejects a stale token', async () => {
    const settings: LobbySettings = { era: 'current', mode: 'normal' };
    const host = await createLobby('Host', settings);
    await join(host.code, 'Guest');
    const lobby = await view(host.code, host.host.secret);
    const token = progressToken(lobby);
    const events = lobby.events[0]?.id ?? 0;
    expect((await viewHandler(pollWith(host.host.secret, host.code, lobby.version, token, events))).status).toBe(204);
    expect((await viewHandler(pollWith(host.host.secret, host.code, lobby.version, 'stale', events))).status).toBe(200);
    expect((await start(host.code, host.host.secret, settings)).status).toBe(200);
    const response = await viewHandler(pollWith(host.host.secret, host.code, lobby.version, token, events));
    expect(response.status).toBe(200);
    const body = await read<{ lobby?: LobbyView }>(response);
    expect(body.lobby?.phase).toBe('draw');
  }, 60_000);

  it('decides the cheap path from the version and token', async () => {
    const settings: LobbySettings = { era: 'current', mode: 'normal' };
    const host = await createLobby('Host', settings);
    const lobby = await view(host.code, host.host.secret);
    const token = progressToken(lobby);
    expect(await unchangedPoll({ code: host.code, secret: host.host.secret, since: lobby.version, token })).toBe('no_content');
    expect(await unchangedPoll({ code: host.code, secret: host.host.secret, since: lobby.version, token: 'stale' })).toBe('read');
    expect(await unchangedPoll({ code: host.code, secret: host.host.secret, since: lobby.version - 1, token })).toBe('read');
  }, 60_000);

  it('rejects a removed player on the cheap poll path', async () => {
    const settings: LobbySettings = { era: 'current', mode: 'normal' };
    const host = await createLobby('Host', settings);
    const guest = await join(host.code, 'Guest');
    const lobby = await view(host.code, host.host.secret);
    const token = progressToken(lobby);
    const events = lobby.events[0]?.id ?? 0;
    await db().query(
      "update participants set last_seen = now() - interval '10 minutes' where lobby_id = (select id from lobbies where code = $1) and seat = $2",
      [host.code, guest.seat],
    );
    expect((await remove(host.code, host.host.secret, guest.seat)).status).toBe(200);
    const response = await viewHandler(pollWith(guest.secret, host.code, lobby.version, token, events));
    expect(response.status).toBe(403);
  }, 60_000);

  it('still advances a checkpoint and the reveal clock on a poll', async () => {
    const { code, seats } = await setupBuilding('normal', 2);
    await advance(code, seats[0]!.secret, 0);
    for (const seat of seats) await ready(code, seat.secret, 0);
    const season = await view(code, seats[0]!.secret);
    expect(season.phase).toBe('season');
    await fastForward(code);
    for (const seat of seats) await ready(code, seat.secret, season.stage);
    const before = await view(code, seats[0]!.secret);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const advanced = await viewHandler(pollWith(seats[0]!.secret, code, before.version, progressToken(before), before.events[0]?.id ?? 0));
    expect(advanced.status).toBe(200);
    const next = (await read<{ lobby: LobbyView }>(advanced)).lobby;
    expect(next.version).toBeGreaterThan(before.version);
    expect(next.stage).toBeGreaterThanOrEqual(season.stage);
  }, 120_000);

  it('keeps the draw open for a reroll window after the last draw', async () => {
    const settings: LobbySettings = { era: 'current', mode: 'normal' };
    const host = await createLobby('Host', settings);
    const guest = await join(host.code, 'Guest');
    expect((await start(host.code, host.host.secret, settings)).status).toBe(200);
    expect((await draw(host.code, host.host.secret)).phase).toBe('draw');
    expect((await draw(host.code, guest.secret)).phase).toBe('draw');
    const rerolled = await reroll(host.code, host.host.secret);
    expect(rerolled.phase).toBe('draw');
    expect(rerolled.teams.find((entry) => entry.seat === host.host.seat)?.rerollUsed).toBe(true);
    await db().query(
      "update lobby_teams set created_at = now() - interval '20 seconds' where lobby_id = (select id from lobbies where code = $1)",
      [host.code],
    );
    expect((await view(host.code, host.host.secret)).phase).toBe('building');
  }, 60_000);

  it('clears the rematch ready flag before the next preview', async () => {
    const { code, seats } = await setupBuilding('normal', 2);
    for (let index = 0; index < seats.length; index++) {
      const seat = seats[index] as Seat;
      const lobby = await view(code, seat.secret);
      await submitOk(code, seat.secret, await buildFor('normal', lobby, index));
    }
    for (const seat of seats) await ready(code, seat.secret, 0);
    expect((await view(code, seats[0]!.secret)).phase).toBe('season');
    await db().query("update lobbies set phase = 'recap' where code = $1", [code]);
    expect((await rematch(code, seats[0]!.secret)).status).toBe(200);
    for (const seat of seats) await ready(code, seat.secret, 0);
    expect((await advance(code, seats[0]!.secret, 0)).status).toBe(200);
    expect((await view(code, seats[0]!.secret)).phase).toBe('draw');
    for (const seat of seats) await draw(code, seat.secret);
    await lock(code, seats[0]!.secret);
    for (let index = 0; index < seats.length; index++) {
      const seat = seats[index] as Seat;
      const lobby = await view(code, seat.secret);
      await submitOk(code, seat.secret, await buildFor('normal', lobby, index));
    }
    const preview = await view(code, seats[0]!.secret);
    expect(preview.phase).toBe('preview');
    expect(preview.participants.every((entry) => !entry.ready)).toBe(true);
    for (const seat of seats) await ready(code, seat.secret, 0);
    expect((await view(code, seats[0]!.secret)).phase).toBe('season');
  }, 120_000);

  it('gives a rejoining player a fresh build and readiness', async () => {
    const { code, seats } = await setupBuilding('normal', 2);
    const guest = seats[1] as Seat;
    const lobby = await view(code, guest.secret);
    await submitOk(code, guest.secret, await buildFor('normal', lobby, 1));
    const leave = leaveAction;
    expect((await leave(authed(guest.secret, `lobby/${code}/leave`, { actionId: newActionId() }))).status).toBe(200);
    const rejoined = await joinHandler(authed(guest.secret, `lobby/${code}/join`, { name: 'Guest', actionId: newActionId() }));
    expect(rejoined.status).toBe(200);
    const back = (await read<{ lobby: LobbyView }>(rejoined)).lobby;
    expect(back.me.status).toBe('joined');
    expect(back.me.build).toBeNull();
    expect(back.me.ready).toBe(false);
    await submitOk(code, guest.secret, await buildFor('normal', back, 1));
  }, 60_000);

  it('does not treat a rejoining player as ready for the rematch', async () => {
    const { code, seats } = await setupBuilding('normal', 2);
    for (let index = 0; index < seats.length; index++) {
      const seat = seats[index] as Seat;
      const lobby = await view(code, seat.secret);
      await submitOk(code, seat.secret, await buildFor('normal', lobby, index));
    }
    for (const seat of seats) await ready(code, seat.secret, 0);
    expect((await view(code, seats[0]!.secret)).phase).toBe('season');
    const guest = seats[1] as Seat;
    const leave = leaveAction;
    expect((await leave(authed(guest.secret, `lobby/${code}/leave`, { actionId: newActionId() }))).status).toBe(200);
    await db().query("update lobbies set phase = 'recap' where code = $1", [code]);
    expect((await rematch(code, seats[0]!.secret)).status).toBe(200);
    const rejoined = await joinHandler(authed(guest.secret, `lobby/${code}/join`, { name: 'Guest', actionId: newActionId() }));
    expect(rejoined.status).toBe(200);
    const back = (await read<{ lobby: LobbyView }>(rejoined)).lobby;
    expect(back.me.status).toBe('joined');
    expect(back.me.ready).toBe(false);
    expect(back.me.build).toBeNull();
    await ready(code, seats[0]!.secret, 0);
    expect((await advance(code, seats[0]!.secret, 0)).status).toBe(409);
  }, 120_000);

  it('removes the previous game slices on rematch', async () => {
    const { code, seats } = await setupBuilding('normal', 2);
    for (let index = 0; index < seats.length; index++) {
      const seat = seats[index] as Seat;
      const lobby = await view(code, seat.secret);
      await submitOk(code, seat.secret, await buildFor('normal', lobby, index));
    }
    for (const seat of seats) await ready(code, seat.secret, 0);
    expect((await view(code, seats[0]!.secret)).phase).toBe('season');
    const counts = async () =>
      (
        await db().query<{ slices: number; games: number; checkpoints: number }>(
          `select
             (select count(*)::int from league_slices where lobby_id = l.id) as slices,
             (select count(*)::int from league_slice_games where lobby_id = l.id) as games,
             (select count(*)::int from league_slice_checkpoints where lobby_id = l.id) as checkpoints
           from lobbies l where l.code = $1`,
          [code],
        )
      )[0];
    expect((await counts())?.games).toBeGreaterThan(0);
    await db().query("update lobbies set phase = 'recap' where code = $1", [code]);
    expect((await rematch(code, seats[0]!.secret)).status).toBe(200);
    expect(await counts()).toEqual({ slices: 0, games: 0, checkpoints: 0 });
  }, 120_000);

  it('retries a preview whose league claim was abandoned', async () => {
    const { code, seats } = await setupBuilding('normal', 2);
    const hostLobby = await view(code, seats[0]!.secret);
    await submitOk(code, seats[0]!.secret, await buildFor('normal', hostLobby, 0));
    expect((await advance(code, seats[0]!.secret, 0)).status).toBe(200);
    const rows = await db().query<{ id: string; phase: string }>('select id, phase from lobbies where code = $1', [code]);
    expect(rows[0]?.phase).toBe('preview');
    await db().query(
      "update lobbies set league_version = -1, league_claimed_at = now() - interval '5 minutes' where id = $1::uuid",
      [rows[0]!.id],
    );
    await computeLeagueFor(rows[0]!.id);
    const after = await db().query<{ phase: string; league_version: number | string }>(
      'select phase, league_version from lobbies where id = $1::uuid',
      [rows[0]!.id],
    );
    expect(after[0]?.phase).toBe('season');
    expect(Number(after[0]?.league_version)).toBeGreaterThan(0);
  }, 120_000);

  it('lets a non-host advance a checkpoint once the host has been idle past the deadline', async () => {
    const { code, seats } = await setupBuilding('normal', 2);
    for (let index = 0; index < seats.length; index++) {
      const seat = seats[index] as Seat;
      const lobby = await view(code, seat.secret);
      await submitOk(code, seat.secret, await buildFor('normal', lobby, index));
    }
    for (const seat of seats) await ready(code, seat.secret, 0);
    expect((await view(code, seats[0]!.secret)).phase).toBe('season');
    await fastForward(code);
    for (const seat of seats) await ready(code, seat.secret, 0);
    const advanced = await view(code, seats[0]!.secret);
    const stage = advanced.stage;
    expect(stage).toBeGreaterThan(0);
    await fastForward(code);
    const rows = await db().query<{ id: string }>('select id from lobbies where code = $1', [code]);
    await db().query('update lobbies set stage_started_at = now() where id = $1::uuid', [rows[0]!.id]);
    const guest = seats[1] as Seat;
    await ready(code, guest.secret, stage);
    expect((await view(code, seats[0]!.secret)).stage).toBe(stage);
    expect((await advance(code, guest.secret, stage)).status).toBe(409);
    await db().query("update lobbies set stage_started_at = now() - interval '1 hour' where id = $1::uuid", [rows[0]!.id]);
    expect((await advance(code, guest.secret, stage)).status).toBe(200);
    expect((await view(code, guest.secret)).stage).toBe(stage + 1);
  }, 120_000);

  it('rejects a left player on the full read', async () => {
    const { code, seats } = await setupBuilding('normal', 2);
    const guest = seats[1] as Seat;
    const leave = leaveAction;
    expect((await leave(authed(guest.secret, `lobby/${code}/leave`, { actionId: newActionId() }))).status).toBe(200);
    expect((await viewHandler(poll(guest.secret, code))).status).toBe(403);
  }, 60_000);
});
