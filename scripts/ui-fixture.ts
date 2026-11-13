import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLocalEnv } from './lib.ts';
import { db } from '../src/server/db.ts';
import { generateSecret, newActionId } from '../src/shared/mp/codes.ts';
import type { LobbySettings, LobbyView } from '../src/shared/mp/types.ts';

interface Seat {
  secret: string;
  name: string;
}

interface DrawFixture {
  code: string;
  hostSecret: string;
  guestSecret: string;
  phase: string;
}

interface LeagueFixture {
  code: string;
  seats: Seat[];
  stage: number;
}

interface ApiBody {
  lobby?: LobbyView;
  code?: string;
  error?: string;
}

const settings: LobbySettings = { era: 'current', mode: 'normal' };

function runDir(): string {
  const pointer = path.join(os.homedir(), '.cache', 'verify-build-a-bucket', 'current');
  return fs.readFileSync(pointer, 'utf8').trim();
}

function baseUrl(): string {
  const state = JSON.parse(fs.readFileSync(path.join(runDir(), 'run.json'), 'utf8')) as { base: string };
  return state.base;
}

async function api(route: string, secret: string, body?: Record<string, unknown>): Promise<ApiBody> {
  const response = await fetch(`${baseUrl()}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await response.json()) as ApiBody;
  if (!response.ok) throw new Error(`${route} ${response.status}: ${json.error ?? 'request failed'}`);
  return json;
}

function writeSession(name: string, code: string, secret: string, playerName: string): void {
  const state = {
    cookies: [],
    origins: [
      {
        origin: baseUrl(),
        localStorage: [{ name: 'bab:mp:v1', value: JSON.stringify({ v: 1, code, secret, name: playerName }) }],
      },
    ],
  };
  fs.writeFileSync(path.join(runDir(), `session-${name}.json`), JSON.stringify(state, null, 2));
}

function writeFixture(name: string, data: unknown): void {
  fs.writeFileSync(path.join(runDir(), `fixture-${name}.json`), JSON.stringify(data, null, 2));
}

function recordLobby(code: string): void {
  const statePath = path.join(runDir(), 'run.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as { lobbies?: string[] };
  state.lobbies = [...(state.lobbies ?? []), code];
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function readFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(runDir(), `fixture-${name}.json`), 'utf8')) as T;
}

async function createLobby(name: string, secret: string): Promise<string> {
  const created = await api('/api/lobby', secret, { name, actionId: newActionId(), settings });
  if (!created.code) throw new Error('create returned no code');
  recordLobby(created.code);
  return created.code;
}

async function join(code: string, name: string, secret: string): Promise<void> {
  await api(`/api/lobby/${code}/join`, secret, { name, actionId: newActionId() });
}

async function start(code: string, secret: string): Promise<void> {
  await api(`/api/lobby/${code}/start`, secret, { actionId: newActionId(), settings });
}

async function draw(code: string, secret: string): Promise<void> {
  await api(`/api/lobby/${code}/draw`, secret, { actionId: newActionId() });
}

async function lock(code: string, secret: string): Promise<void> {
  await api(`/api/lobby/${code}/lock`, secret, { actionId: newActionId() });
}

async function advance(code: string, secret: string, stage: number): Promise<void> {
  await api(`/api/lobby/${code}/advance`, secret, { actionId: newActionId(), stage });
}

async function ready(code: string, secret: string, stage: number): Promise<void> {
  await api(`/api/lobby/${code}/ready`, secret, { actionId: newActionId(), stage });
}

async function view(code: string, secret: string): Promise<LobbyView> {
  const result = await api(`/api/lobby/${code}`, secret);
  if (!result.lobby) throw new Error('view returned no lobby');
  return result.lobby;
}

async function fastForward(code: string, secret: string): Promise<LobbyView> {
  const current = await view(code, secret);
  if (!current.league) throw new Error('no league to fast-forward');
  await db().query(
    "update lobbies set stage_started_at = now() - interval '1 hour', stage_cursor = $2 where code = $1",
    [code, current.league.stageTotal],
  );
  return view(code, secret);
}

async function driveTo(code: string, seats: Seat[], target: number): Promise<LobbyView> {
  let current = await view(code, seats[0]!.secret);
  while (current.stage < target) {
    await fastForward(code, seats[0]!.secret);
    for (const seat of seats) await ready(code, seat.secret, current.stage);
    current = await view(code, seats[0]!.secret);
  }
  await fastForward(code, seats[0]!.secret);
  return view(code, seats[0]!.secret);
}

async function drawFixture(): Promise<void> {
  const hostSecret = generateSecret();
  const code = await createLobby('Ava', hostSecret);
  const guestSecret = generateSecret();
  await join(code, 'Ben', guestSecret);
  await start(code, hostSecret);
  await draw(code, hostSecret);
  const current = await view(code, hostSecret);
  if (current.phase !== 'draw') throw new Error(`expected draw, got ${current.phase}`);
  writeSession('draw', code, hostSecret, 'Ava');
  writeSession('draw-guest', code, guestSecret, 'Ben');
  writeFixture('draw', { code, hostSecret, guestSecret, phase: 'draw' } satisfies DrawFixture);
  console.log(JSON.stringify({ code, phase: current.phase }));
}

async function lockFixture(): Promise<void> {
  const fixture = readFixture<DrawFixture>('draw');
  await lock(fixture.code, fixture.hostSecret);
  const current = await view(fixture.code, fixture.hostSecret);
  if (current.phase !== 'building') throw new Error(`expected building, got ${current.phase}`);
  writeSession('draw', fixture.code, fixture.hostSecret, 'Ava');
  writeSession('draw-guest', fixture.code, fixture.guestSecret, 'Ben');
  writeFixture('draw', { ...fixture, phase: 'building' } satisfies DrawFixture);
  console.log(JSON.stringify({ code: fixture.code, phase: current.phase }));
}

async function createLeague(): Promise<{ code: string; seats: Seat[] }> {
  const hostSecret = generateSecret();
  const code = await createLobby('Ava', hostSecret);
  const guestSecret = generateSecret();
  await join(code, 'Ben', guestSecret);
  await start(code, hostSecret);
  await draw(code, hostSecret);
  await draw(code, guestSecret);
  await lock(code, hostSecret);
  await advance(code, hostSecret, 0);
  await ready(code, hostSecret, 0);
  await ready(code, guestSecret, 0);
  const current = await view(code, hostSecret);
  if (current.phase !== 'season') throw new Error(`expected season, got ${current.phase}`);
  return {
    code,
    seats: [
      { secret: hostSecret, name: 'Ava' },
      { secret: guestSecret, name: 'Ben' },
    ],
  };
}

async function leagueFixture(): Promise<void> {
  const league = await createLeague();
  const current = await driveTo(league.code, league.seats, 0);
  writeSession('league', league.code, league.seats[0]!.secret, 'Ava');
  writeSession('league-guest', league.code, league.seats[1]!.secret, 'Ben');
  writeFixture('league', { ...league, stage: current.stage } satisfies LeagueFixture);
  console.log(JSON.stringify({ code: league.code, stage: current.stage, phase: current.phase }));
}

async function stageFixture(target: number): Promise<void> {
  const fixture = readFixture<LeagueFixture>('league');
  const current = await driveTo(fixture.code, fixture.seats, target);
  writeSession('league', fixture.code, fixture.seats[0]!.secret, 'Ava');
  writeSession('league-guest', fixture.code, fixture.seats[1]!.secret, 'Ben');
  writeFixture('league', { ...fixture, stage: current.stage } satisfies LeagueFixture);
  console.log(JSON.stringify({ code: fixture.code, stage: current.stage, phase: current.phase }));
}

async function inviteFixture(): Promise<void> {
  const hostSecret = generateSecret();
  const code = await createLobby('Ava', hostSecret);
  writeFixture('invite', { code });
  console.log(JSON.stringify({ code }));
}

loadLocalEnv();
const command = process.argv[2];
if (command === 'draw') await drawFixture();
else if (command === 'lock') await lockFixture();
else if (command === 'league') await leagueFixture();
else if (command === 'stage') await stageFixture(Number(process.argv[3]));
else if (command === 'invite') await inviteFixture();
else throw new Error('usage: ui-fixture.ts draw|lock|league|stage <n>|invite');
