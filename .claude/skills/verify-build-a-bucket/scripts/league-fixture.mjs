import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

function defaultPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function hashSecret(secret) {
  return createHash('sha256').update(secret).digest('hex');
}

export async function defaultConnect(target) {
  const { createRunner } = await import('./meter/local-pg.mjs');
  return createRunner(target);
}

function uuidFrom(value) {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function guardOwnedRun({ run, base, readFile = fs.readFileSync, pidAlive = defaultPidAlive }) {
  if (base) throw new Error('fixture refuses --base');
  if (!run || run.neon === true || run.prod === true || run.devLocal !== true) throw new Error('fixture requires a dev-local run');
  if (!run.supervisorPid || !pidAlive(run.supervisorPid)) throw new Error('fixture requires a live supervisor');
  if (!run.postgresPid || !pidAlive(run.postgresPid)) throw new Error('fixture requires a live postgres');
  if (typeof run.socketDir !== 'string' || !path.isAbsolute(run.socketDir)) throw new Error('fixture requires an absolute socket dir');
  if (!Number.isInteger(run.port) || run.port <= 0) throw new Error('fixture requires a positive integer port');
  if (typeof run.database !== 'string' || run.database.length === 0) throw new Error('fixture requires a non-empty database');
  if (typeof run.socket !== 'string') throw new Error('fixture requires a socket path');
  if (typeof run.postmasterPidPath !== 'string') throw new Error('fixture requires a postmaster.pid path');
  const socket = path.resolve(run.socket);
  const dir = path.resolve(run.socketDir);
  if (socket !== path.join(dir, `.s.PGSQL.${run.port}`)) throw new Error('socket does not match the owned socket dir and port');
  const lines = String(readFile(run.postmasterPidPath, 'utf8')).split('\n');
  if (lines[0]?.trim() !== String(run.postgresPid)) throw new Error('postmaster.pid does not match the recorded postgres pid');
  if (lines[3]?.trim() !== String(run.port)) throw new Error('postmaster.pid port does not match the recorded port');
  if (lines[4]?.trim() !== run.socketDir) throw new Error('postmaster.pid socket dir does not match the recorded socket dir');
  return { socketDir: run.socketDir, port: run.port, database: run.database };
}

export async function applyLeagueFixture({ entry, run, connect = defaultConnect, secrets }) {
  if (!entry || !Array.isArray(entry.participants) || entry.participants.length !== entry.players) throw new Error('fixture entry is incomplete');
  if (!Array.isArray(secrets) || secrets.length !== entry.players) throw new Error('fixture needs one secret per seat');
  const target = guardOwnedRun({ run, base: run?.base, readFile: run?.readFile, pidAlive: run?.pidAlive });
  const runner = await connect(target);
  const hashes = secrets.map((secret) => hashSecret(secret));
  const lobbyId = uuidFrom(`${entry.id}:lobby`);
  const queries = [
    {
      text: 'insert into lobbies (id, code, phase, settings, mode, era, version, season_secret, host_participant, locked_at) values ($1::uuid, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::uuid, now())',
      params: [lobbyId, entry.code, 'preview', JSON.stringify({ mode: entry.mode, era: entry.era }), entry.mode, entry.era, 1, entry.secret, entry.participants[0].id],
    },
    ...entry.participants.flatMap((participant) => [
      {
        text: 'insert into participants (id, lobby_id, token_hash, name, seat, status, build, build_kind, build_summary, preview_ready, ready_stage, team) values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12)',
        params: [participant.id, lobbyId, hashes[participant.seat - 1], participant.name, participant.seat, 'ready', JSON.stringify(participant.build), participant.build.kind, JSON.stringify(participant.summary), false, -1, participant.team],
      },
      {
        text: 'insert into lobby_teams (lobby_id, participant_id, team, reroll_used) values ($1::uuid, $2::uuid, $3, $4)',
        params: [lobbyId, participant.id, participant.team, false],
      },
    ]),
  ];
  try {
    await runner.transaction(queries);
    return { lobbyId, code: entry.code, participantIds: entry.participants.map((participant) => participant.id), target };
  } finally {
    await runner.close?.();
  }
}
