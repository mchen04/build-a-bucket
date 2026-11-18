import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupMembers, probePid, probePort, readProcessIdentity } from '../.claude/skills/verify-build-a-bucket/scripts/process-control.mjs';
import { runSupervised, stopService } from '../.claude/skills/verify-build-a-bucket/scripts/supervisor.mjs';

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

function controls() {
  return { readIdentity: readProcessIdentity, groupMembers, probe: probePid, probePort, clock: { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval } };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

export function prepareLocalDb(options = {}) {
  const root = options.root ?? REPO;
  const pgPort = Number(options.pgPort ?? process.env.BAB_LOCAL_PG_PORT ?? 55434);
  const database = options.database ?? 'bab_local';
  const dataDir = options.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'bab-local-db-'));
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    execFileSync(tool('initdb'), ['-D', dataDir, '-A', 'trust', '-U', USER, '--no-sync'], { stdio: 'ignore' });
  }
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

export async function startLocalDb(options = {}) {
  const prepared = prepareLocalDb(options);
  const { dataDir, pgPort, database, root } = prepared;
  const schema = options.schema ?? path.join(root, 'db', 'schema.sql');
  const child = spawn(
    tool('postgres'),
    ['-D', dataDir, '-p', String(pgPort), '-k', '/tmp', '-c', `listen_addresses=${HOST}`, '-c', 'fsync=off', '-c', 'full_page_writes=off', '-c', 'synchronous_commit=off', '-c', 'max_connections=100'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      psql(pgPort, 'postgres', 'select 1');
      ready = true;
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!ready) {
    const result = await stopService({ service: { name: 'postgres', kind: 'postgres', port: pgPort }, child, controls: controls() });
    if (options.receiptPath) writeJson(options.receiptPath, { ok: result.state === 'clean', services: [result] });
    throw new Error('local postgres did not become ready');
  }
  psql(pgPort, 'postgres', `drop database if exists ${database}`);
  psql(pgPort, 'postgres', `create database ${database}`);
  execFileSync(tool('psql'), ['-h', HOST, '-p', String(pgPort), '-U', USER, '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-f', schema], {
    stdio: 'ignore',
  });
  return { ...prepared, child };
}

export async function stopLocalDb(handle) {
  if (!handle?.child) return { state: 'clean', reason: null };
  const result = await stopService({ service: { name: 'postgres', kind: 'postgres', port: handle.pgPort }, child: handle.child, controls: controls() });
  if (result.state === 'clean' && handle.remove) fs.rmSync(handle.dataDir, { recursive: true, force: true });
  return result;
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
  const receiptPath = process.env.BAB_LOCAL_DB_RECEIPT;
  const handle = await startLocalDb({
    pgPort: value('pg-port', process.env.BAB_LOCAL_PG_PORT ?? 55434),
    dataDir: value('data-dir', undefined),
    remove: !flags.includes('--keep'),
    receiptPath,
  });
  process.stderr.write(`local postgres ${handle.url}\n`);
  const result = await runSupervised({
    children: [{ service: { name: 'postgres', kind: 'postgres', port: handle.pgPort }, child: handle.child }],
    command,
    commandEnv: { ...process.env, ...localDbEnv(handle) },
    commandCwd: handle.root,
    controls: { ...controls(), spawn },
    receiptPath,
  });
  if (result.results[0]?.state === 'clean' && handle.remove) fs.rmSync(handle.dataDir, { recursive: true, force: true });
  process.exitCode = result.code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
