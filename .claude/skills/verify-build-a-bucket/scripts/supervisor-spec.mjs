import path from 'node:path';

export function buildSupervisorSpec({ mode, port, dir, repo, prepared }) {
  const services = [];
  if (mode === 'prod') {
    services.push({
      name: 'app',
      kind: 'app',
      command: path.join(repo, 'node_modules/.bin/vite'),
      args: ['preview', '--port', String(port), '--strictPort'],
      cwd: repo,
      env: {},
      envFromPostgres: false,
      detached: true,
      logPath: path.join(dir, 'server.log'),
    });
  } else {
    services.push({
      name: 'app',
      kind: 'app',
      command: process.execPath,
      args: ['scripts/dev-server.ts', '--port', String(port), '--strictPort'],
      cwd: repo,
      env: {},
      envFromPostgres: Boolean(prepared),
      detached: true,
      logPath: path.join(dir, 'server.log'),
    });
  }
  return {
    postgresInit: prepared
      ? { root: dir, port: prepared.pgPort, database: prepared.database, schema: path.join(repo, 'db', 'schema.sql') }
      : null,
    services,
  };
}
