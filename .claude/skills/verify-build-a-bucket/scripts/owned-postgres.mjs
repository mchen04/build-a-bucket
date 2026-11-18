import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn as realSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const USER = 'postgres';
const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'meter/local-pg.mjs');

export function socketPath(sockDir, port) {
  return path.join(sockDir, `.s.PGSQL.${port}`);
}

export function checkSocketPath(sockDir, port) {
  const file = socketPath(sockDir, port);
  const bytes = Buffer.byteLength(file);
  if (bytes > 103) throw new Error(`socket path too long (${bytes} > 103): ${file}`);
  return file;
}

export function ownedPostgresEnv({ sockDir, port, database }) {
  return {
    BAB_PG_SOCKET_DIR: sockDir,
    BAB_PG_PORT: String(port),
    BAB_PG_DATABASE: database,
    BAB_PG_USER: USER,
    BAB_DB_RUNNER: RUNNER,
    DATABASE_URL: `postgresql://${USER}@/${database}?host=${encodeURIComponent(sockDir)}&port=${port}`,
  };
}

export async function createOwnedPostgres({
  root,
  port,
  database = 'bab_local',
  schema,
  spawn = realSpawn,
  psql,
  initdb,
  schemaLoad,
  clock = { setTimeout: globalThis.setTimeout },
  onChild,
  reuse = false,
  logPath,
}) {
  const dataDir = fs.mkdtempSync(path.join(root, 'pgdata-'));
  const sockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bab-pgsock-'));
  const pgBin = process.env.BAB_PG_BIN ?? '/opt/homebrew/bin';
  fs.chmodSync(dataDir, 0o700);
  fs.chmodSync(sockDir, 0o700);
  const sock = checkSocketPath(sockDir, port);
  if (!reuse && fs.existsSync(path.join(dataDir, 'PG_VERSION'))) throw new Error('data dir already initialized');
  const init = initdb ?? (() => execFileSync(path.join(pgBin, 'initdb'), ['-D', dataDir, '-A', 'trust', '-U', USER, '--no-sync'], { stdio: 'ignore' }));
  init({ dataDir, sockDir, port });
  const log = logPath ? fs.openSync(logPath, 'a') : 'ignore';
  const child = spawn(path.join(pgBin, 'postgres'), ['-D', dataDir, '-k', sockDir, '-c', 'listen_addresses=', '-p', String(port), '-c', 'fsync=off', '-c', 'full_page_writes=off', '-c', 'synchronous_commit=off', '-c', 'max_connections=100'], { stdio: ['ignore', log, log] });
  let spawnError = null;
  child.once('error', (error) => {
    spawnError = error;
  });
  child.once('exit', () => {});
  if (onChild) onChild(child, port);
  const prove = () => {
    if (child.exitCode !== null || child.signalCode) throw new Error('postgres exited before ownership proof');
    const pidFile = fs.readFileSync(path.join(dataDir, 'postmaster.pid'), 'utf8').split('\n')[0].trim();
    if (Number(pidFile) !== child.pid) throw new Error('postmaster.pid does not match the owned child');
    if (!fs.existsSync(sock)) throw new Error('socket file missing');
  };
  const psqlFn = psql ?? ((sql, db = 'postgres') => execFileSync(path.join(pgBin, 'psql'), ['-h', sockDir, '-p', String(port), '-U', USER, '-d', db, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], { encoding: 'utf8' }));
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode) throw new Error('postgres exited before readiness');
    try {
      prove();
      psqlFn('select 1');
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => clock.setTimeout(resolve, 250));
    }
  }
  if (!ready) throw new Error('owned postgres did not become ready');
  prove();
  psqlFn(`create database ${database}`);
  prove();
  const load = schemaLoad ?? (() => execFileSync(path.join(pgBin, 'psql'), ['-h', sockDir, '-p', String(port), '-U', USER, '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-f', schema], { stdio: 'ignore' }));
  load();
  return {
    dataDir,
    sockDir,
    port,
    database,
    child,
    env: ownedPostgresEnv({ sockDir, port, database }),
  };
}
