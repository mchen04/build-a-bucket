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

async function defaultConnect(target) {
  process.env.BAB_PG_SOCKET_DIR = target.socketDir;
  process.env.BAB_PG_PORT = String(target.port);
  process.env.BAB_PG_DATABASE = target.database;
  const { createRunner } = await import('./meter/local-pg.mjs');
  return createRunner();
}

export function guardOwnedRun({ run, base, readFile = fs.readFileSync, pidAlive = defaultPidAlive }) {
  if (base) throw new Error('fixture refuses --base');
  if (!run || run.neon === true || run.prod === true || run.devLocal !== true) throw new Error('fixture requires a dev-local run');
  if (!run.supervisorPid || !pidAlive(run.supervisorPid)) throw new Error('fixture requires a live supervisor');
  if (!run.postgresPid || !pidAlive(run.postgresPid)) throw new Error('fixture requires a live postgres');
  const pidLine = String(readFile(run.postmasterPidPath, 'utf8')).split('\n')[0].trim();
  if (pidLine !== String(run.postgresPid)) throw new Error('postmaster.pid does not match the recorded postgres pid');
  const socket = path.resolve(run.socket);
  const dir = path.resolve(run.socketDir);
  if (socket !== dir && !socket.startsWith(`${dir}${path.sep}`)) throw new Error('socket is outside the owned socket dir');
  return { socketDir: run.socketDir, port: run.port, database: run.database };
}

export async function applyLeagueFixture({ entry, run, connect = defaultConnect, secrets }) {
  if (!entry || !Array.isArray(entry.participants) || entry.participants.length !== entry.players) throw new Error('fixture entry is incomplete');
  if (!Array.isArray(secrets) || secrets.length !== entry.players) throw new Error('fixture needs one secret per seat');
  const target = guardOwnedRun({ run, base: run?.base, readFile: run?.readFile, pidAlive: run?.pidAlive });
  const runner = await connect(target);
  const hashes = secrets.map((secret) => hashSecret(secret));
  try {
    await runner.query('BEGIN');
    const lobbyRows = await runner.query(
      'insert into lobbies (code, phase, settings, mode, era, version, season_secret, host_participant, locked_at) values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8::uuid, now()) returning id',
      [entry.code, 'preview', JSON.stringify({ mode: entry.mode, era: entry.era }), entry.mode, entry.era, 1, entry.secret, entry.participants[0].id],
    );
    const lobbyId = lobbyRows[0].id;
    for (const participant of entry.participants) {
      await runner.query(
        'insert into participants (id, lobby_id, token_hash, name, seat, status, build, build_kind, build_summary, preview_ready, ready_stage, team) values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12)',
        [participant.id, lobbyId, hashes[participant.seat - 1], participant.name, participant.seat, 'ready', JSON.stringify(participant.build), participant.build.kind, JSON.stringify(participant.summary), false, -1, participant.team],
      );
      await runner.query('insert into lobby_teams (lobby_id, participant_id, team, reroll_used) values ($1::uuid, $2::uuid, $3, $4)', [lobbyId, participant.id, participant.team, false]);
    }
    await runner.query('COMMIT');
    return { lobbyId, code: entry.code, participantIds: entry.participants.map((participant) => participant.id), target };
  } catch (error) {
    await runner.query('ROLLBACK');
    throw error;
  } finally {
    await runner.close?.();
  }
}
