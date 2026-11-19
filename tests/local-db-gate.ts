import { describe } from 'vitest';
import path from 'node:path';

export function dbSuiteMode() {
  const runner = process.env.BAB_DB_RUNNER;
  const url = process.env.DATABASE_URL ?? '';
  const sock = process.env.BAB_PG_SOCKET_DIR;
  const port = process.env.BAB_PG_PORT;
  const database = process.env.BAB_PG_DATABASE;
  if (!runner) return 'skip';
  if (!sock || !port || !database) throw new Error('BAB_DB_RUNNER is set but the owned socket env is partial');
  if (!path.isAbsolute(sock)) throw new Error('BAB_DB_RUNNER is set but BAB_PG_SOCKET_DIR is not absolute');
  if (/^postgres(ql)?:\/\/[^@]*@[^/]/.test(url)) throw new Error('BAB_DB_RUNNER is set but DATABASE_URL is hosted');
  const match = /^postgres(ql)?:\/\/([^@]*)@\/([^?]*)\?(.*)$/.exec(url);
  if (!match) throw new Error('BAB_DB_RUNNER is set but DATABASE_URL is not a socket URL');
  const params = new URLSearchParams(match[4]);
  if (params.get('host') !== sock) throw new Error('BAB_DB_RUNNER is set but DATABASE_URL host does not match BAB_PG_SOCKET_DIR');
  if (params.get('port') !== port) throw new Error('BAB_DB_RUNNER is set but DATABASE_URL port does not match BAB_PG_PORT');
  if (match[3] !== database) throw new Error('BAB_DB_RUNNER is set but DATABASE_URL database does not match BAB_PG_DATABASE');
  return 'run';
}

export function dbSuite() {
  return dbSuiteMode() === 'run' ? describe : describe.skip;
}
