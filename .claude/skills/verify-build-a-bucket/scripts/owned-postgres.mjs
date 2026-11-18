import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn as realSpawn } from 'node:child_process';

const USER = 'postgres';
const PG_BIN = process.env.BAB_PG_BIN ?? '/opt/homebrew/bin';

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
  const sockDir = fs.mkdtempSync(path.join(root, 'pgsock-'));
  fs.chmodSync(dataDir, 0o700);
  fs.chmodSync(sockDir, 0o700);
  const sock = checkSocketPath(sockDir, port);
  if (!reuse && fs.existsSync(path.join(dataDir, 'PG_VERSION'))) throw new Error('data dir already initialized');
  const init = initdb ?? (() => execFileSync(path.join(PG_BIN, 'initdb'), ['-D', dataDir, '-A', 'trust', '-U', USER, '--no-sync'], { stdio: 'ignore' }));
  init({ dataDir, sockDir, port });
  const log = logPath ? fs.openSync(logPath, 'a') : 'ignore';
  const child = spawn(path.join(PG_BIN, 'postgres'), ['-D', dataDir, '-k', sockDir, '-c', "listen_addresses=''", '-p', String(port), '-c', 'fsync=off', '-c', 'full_page_writes=off', '-c', 'synchronous_commit=off', '-c', 'max_connections=100'], { stdio: ['ignore', log, log] });
  if (onChild) onChild(child, port);
  const prove = () => {
    if (child.exitCode !== null || child.signalCode) throw new Error('postgres exited before ownership proof');
    const pidFile = fs.readFileSync(path.join(dataDir, 'postmaster.pid'), 'utf8').split('\n')[0].trim();
    if (Number(pidFile) !== child.pid) throw new Error('postmaster.pid does not match the owned child');
    if (!fs.existsSync(sock)) throw new Error('socket file missing');
  };
  const psqlFn = psql ?? ((sql, db = 'postgres') => execFileSync(path.join(PG_BIN, 'psql'), ['-h', sockDir, '-p', String(port), '-U', USER, '-d', db, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], { encoding: 'utf8' }));
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
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
  const load = schemaLoad ?? (() => execFileSync(path.join(PG_BIN, 'psql'), ['-h', sockDir, '-p', String(port), '-U', USER, '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-f', schema], { stdio: 'ignore' }));
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
