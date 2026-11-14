import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PG_BIN = process.env.BAB_PG_BIN ?? '/opt/homebrew/bin';
const RUNNER = path.join(REPO, '.claude/skills/verify-build-a-bucket/scripts/meter/local-pg.mjs');
const HOST = '127.0.0.1';
const USER = 'postgres';

function tool(name) {
  const full = path.join(PG_BIN, name);
  if (!fs.existsSync(full)) throw new Error(`${name} not found under ${PG_BIN}; set BAB_PG_BIN`);
  return full;
}

function psql(port, database, sql) {
  return execFileSync(tool('psql'), ['-h', HOST, '-p', String(port), '-U', USER, '-d', database, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], {
    encoding: 'utf8',
  });
}

function pgCtl(dataDir, args, options = {}) {
  return execFileSync(tool('pg_ctl'), ['-D', dataDir, ...args], { encoding: 'utf8', stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'] });
}

export function localDbEnv(handle) {
  return {
    DATABASE_URL: handle.url,
    BAB_DB_RUNNER: handle.runnerPath,
    BAB_PG_HOST: HOST,
    BAB_PG_PORT: String(handle.pgPort),
    BAB_PG_DATABASE: handle.database,
    BAB_PG_USER: USER,
  };
}

export async function startLocalDb(options = {}) {
  const root = options.root ?? REPO;
  const pgPort = Number(options.pgPort ?? process.env.BAB_LOCAL_PG_PORT ?? 55434);
  const database = options.database ?? 'bab_local';
  const dataDir = options.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'bab-local-db-'));
  const schema = options.schema ?? path.join(root, 'db', 'schema.sql');
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    execFileSync(tool('initdb'), ['-D', dataDir, '-A', 'trust', '-U', USER, '--no-sync'], { stdio: 'ignore' });
  }
  try {
    pgCtl(dataDir, ['status'], { stdio: 'ignore' });
  } catch {
    pgCtl(dataDir, [
      '-l',
      path.join(dataDir, 'pg.log'),
      '-o',
      `-p ${pgPort} -k /tmp -c listen_addresses=${HOST} -c fsync=off -c full_page_writes=off -c synchronous_commit=off -c max_connections=100`,
      '-w',
      'start',
    ]);
  }
  psql(pgPort, 'postgres', `drop database if exists ${database}`);
  psql(pgPort, 'postgres', `create database ${database}`);
  execFileSync(tool('psql'), ['-h', HOST, '-p', String(pgPort), '-U', USER, '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-f', schema], {
    stdio: 'ignore',
  });
  return {
    dataDir,
    pgPort,
    database,
    url: `postgres://${USER}@${HOST}:${pgPort}/${database}`,
    runnerPath: RUNNER,
    root,
    remove: options.remove ?? !options.dataDir,
  };
}

export async function stopLocalDb(handle) {
  if (!handle) return;
  try {
    pgCtl(handle.dataDir, ['-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
  } catch {
    return;
  }
  if (handle.remove) fs.rmSync(handle.dataDir, { recursive: true, force: true });
}

async function main() {
  const argv = process.argv.slice(2);
  const split = argv.indexOf('--');
  if (split < 0 || split === argv.length - 1) {
    throw new Error('usage: node scripts/local-db.mjs [--pg-port N] [--data-dir DIR] [--keep] -- <command...>');
  }
  const flags = argv.slice(0, split);
  const command = argv.slice(split + 1);
  const value = (name, fallback) => {
    const index = flags.indexOf(`--${name}`);
    return index >= 0 ? flags[index + 1] ?? fallback : fallback;
  };
  const handle = await startLocalDb({
    pgPort: value('pg-port', process.env.BAB_LOCAL_PG_PORT ?? 55434),
    dataDir: value('data-dir', undefined),
    remove: !flags.includes('--keep'),
  });
  process.stderr.write(`local postgres ${handle.url}\n`);
  const child = spawn(command[0], command.slice(1), { cwd: handle.root, env: { ...process.env, ...localDbEnv(handle) }, stdio: 'inherit' });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  await stopLocalDb(handle);
  process.exitCode = typeof code === 'number' ? code : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
