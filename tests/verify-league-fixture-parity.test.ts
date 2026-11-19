import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { POST as createHandler } from '../api/lobby/index';
import { GET as viewHandler } from '../api/lobby/[code]/index';
import {
  buildAction as buildHandler,
  drawAction as drawHandler,
  joinAction as joinHandler,
  lockAction as lockHandler,
  startAction as startHandler,
} from '../src/server/actions';
import { db } from '../src/server/db';
import { dbSuite } from './local-db-gate';
import { deleteOwned, newOwned, ownedEntry } from './fixture-identity';
import { applyLeagueFixture } from '../.claude/skills/verify-build-a-bucket/scripts/league-fixture.mjs';
import { createRunner } from '../.claude/skills/verify-build-a-bucket/scripts/meter/local-pg.mjs';
import { loadCatalog, poolFor } from '../src/shared/data/loader';
import { BIG_ATTRS, GUARD_ATTRS } from '../src/shared/engine/rules';
import { spinTarget, type SpinRecord } from '../src/shared/engine/spin';
import type { Era, Pick, Position } from '../src/shared/engine/types';
import { generateSecret, newActionId } from '../src/shared/mp/codes';
import type { LobbyBuild, LobbySettings, LobbyView, NormalBuild } from '../src/shared/mp/types';

const BASE = 'http://localhost:4173/api';
const owned = newOwned();

const MAY_DIFFER = {
  lobbies: new Set(['id', 'code', 'host_participant', 'season_secret', 'create_action', 'created_at', 'updated_at', 'stage_started_at', 'locked_at', 'league_claimed_at']),
  participants: new Set(['id', 'lobby_id', 'token_hash', 'name', 'joined_at', 'last_seen', 'build', 'build_summary', 'team']),
  lobby_teams: new Set(['lobby_id', 'participant_id', 'team', 'created_at']),
};

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
  owned.serverCodes.push(body.code);
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

async function view(code: string, secret: string): Promise<LobbyView> {
  const response = await viewHandler(poll(secret, code));
  expect(response.status).toBe(200);
  return (await read<{ lobby: LobbyView }>(response)).lobby;
}

async function submitOk(code: string, secret: string, build: LobbyBuild): Promise<void> {
  const response = await buildHandler(authed(secret, `lobby/${code}/build`, { actionId: newActionId(), build }));
  expect(response.status).toBe(200);
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

async function buildFor(mode: LobbySettings['mode'], lobby: LobbyView, index: number): Promise<LobbyBuild> {
  const seed = lobby.me.buildSeed;
  if (!seed) throw new Error('missing build seed');
  if (mode === 'normal') return spunBuild(seed, index % 2 === 0 ? 'guard' : 'big', lobby.settings.era, index % 3 === 0 ? 'low' : 'high');
  throw new Error(`unsupported mode ${mode}`);
}

async function buildAll(code: string, seats: Seat[]): Promise<void> {
  for (let index = 0; index < seats.length; index++) {
    const seat = seats[index] as Seat;
    await submitOk(code, seat.secret, await buildFor('normal', await view(code, seat.secret), index));
  }
}

async function draw(code: string, secret: string): Promise<LobbyView> {
  const response = await drawHandler(authed(secret, `lobby/${code}/draw`, { actionId: newActionId() }));
  expect(response.status).toBe(200);
  return (await read<{ lobby: LobbyView }>(response)).lobby;
}

async function lock(code: string, secret: string): Promise<void> {
  const response = await lockHandler(authed(secret, `lobby/${code}/lock`, { actionId: newActionId() }));
  expect(response.status).toBe(200);
}

async function drawTeams(code: string, seats: Seat[]): Promise<void> {
  expect((await view(code, seats[0]!.secret)).phase).toBe('draw');
  await Promise.all(seats.map((seat) => draw(code, seat.secret)));
  await lock(code, seats[0]!.secret);
  expect((await view(code, seats[0]!.secret)).phase).toBe('preview');
}

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Date) return 'date';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function compareTable(name: string, real: Record<string, unknown>[], fixture: Record<string, unknown>[], mayDiffer: Set<string>): void {
  expect(real.length, `${name} row count`).toBe(fixture.length);
  if (!real.length) return;
  const realColumns = Object.keys(real[0]!).sort();
  const fixtureColumns = Object.keys(fixture[0]!).sort();
  expect(fixtureColumns, `${name} columns`).toEqual(realColumns);
  for (let index = 0; index < real.length; index++) {
    const a = real[index]!;
    const b = fixture[index]!;
    for (const column of realColumns) {
      expect(kindOf(b[column]), `${name}.${column} kind`).toBe(kindOf(a[column]));
      if (column === 'version') {
        const av = Number(a[column]);
        const bv = Number(b[column]);
        expect(Number.isInteger(av) && av > 0).toBe(true);
        expect(Number.isInteger(bv) && bv > 0).toBe(true);
        continue;
      }
      if (mayDiffer.has(column)) continue;
      expect(b[column], `${name}.${column}`).toEqual(a[column]);
    }
  }
}

function bySeat(teams: Record<string, unknown>[], participants: Record<string, unknown>[]): Record<string, unknown>[] {
  const seatOf = new Map(participants.map((participant) => [participant.id, participant.seat]));
  return [...teams].sort((a, b) => Number(seatOf.get(a.participant_id)) - Number(seatOf.get(b.participant_id)));
}

afterAll(() => deleteOwned(owned));

dbSuite()('fixture rows match the real lobby path', () => {
  const socketDir = process.env.BAB_PG_SOCKET_DIR ?? '';
  const port = Number(process.env.BAB_PG_PORT ?? 0);
  const database = process.env.BAB_PG_DATABASE ?? '';
  const run = {
    devLocal: true,
    supervisorPid: 1,
    postgresPid: 1,
    socketDir,
    port,
    database,
    socket: path.join(socketDir, `.s.PGSQL.${port}`),
    postmasterPidPath: 'stand-in',
    pidAlive: () => true,
    readFile: () => ['1', '', '', String(port), socketDir].join('\n'),
  };
  const connect = (target: { socketDir: string; port: number; database: string }) => createRunner(target);

  it('matches the real lobby path row for row', async () => {
    const settings: LobbySettings = { era: 'current', mode: 'normal' };
    const host = await createLobby('Host', settings);
    const seats: Seat[] = [host.host, await join(host.code, 'P2')];
    expect((await start(host.code, host.host.secret, settings)).status).toBe(200);
    await buildAll(host.code, seats);
    await drawTeams(host.code, seats);
    const realCode = host.code;

    const catalog = JSON.parse(readFileSync(path.join(process.cwd(), '.claude/skills/verify-build-a-bucket/fixtures/league-fixtures.json'), 'utf8'));
    const entry = ownedEntry(owned, catalog.entries.find((candidate: { id: string }) => candidate.id === 'normal-2p-q1'));
    const secrets = entry.participants.map(() => generateSecret());
    await applyLeagueFixture({ entry, run, connect, secrets });
    const fixtureCode = entry.code;

    const realLobby = (await db().query<Record<string, unknown>>('select * from lobbies where code = $1', [realCode]))[0]!;
    const fixtureLobby = (await db().query<Record<string, unknown>>('select * from lobbies where code = $1', [fixtureCode]))[0]!;
    const realParticipants = await db().query<Record<string, unknown>>('select * from participants where lobby_id = $1 order by seat', [realLobby.id]);
    const fixtureParticipants = await db().query<Record<string, unknown>>('select * from participants where lobby_id = $1 order by seat', [fixtureLobby.id]);
    const realTeams = await db().query<Record<string, unknown>>('select * from lobby_teams where lobby_id = $1 order by participant_id', [realLobby.id]);
    const fixtureTeams = await db().query<Record<string, unknown>>('select * from lobby_teams where lobby_id = $1 order by participant_id', [fixtureLobby.id]);

    compareTable('lobbies', [realLobby], [fixtureLobby], MAY_DIFFER.lobbies);
    compareTable('participants', realParticipants, fixtureParticipants, MAY_DIFFER.participants);
    compareTable('lobby_teams', bySeat(realTeams, realParticipants), bySeat(fixtureTeams, fixtureParticipants), MAY_DIFFER.lobby_teams);

    for (const [label, code] of [['real', realCode], ['fixture', fixtureCode]] as const) {
      const events = await db().query<{ kind: string; count: string }>('select kind, count(*)::text as count from events where lobby_id = (select id from lobbies where code = $1) group by kind order by kind', [code]);
      const actions = await db().query<{ count: string }>('select count(*)::text as count from actions where lobby_id = (select id from lobbies where code = $1)', [code]);
      console.log(`${label} events`, events, `${label} actions`, actions[0]?.count);
    }
  }, 120_000);
});
