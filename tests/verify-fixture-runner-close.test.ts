import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { applyLeagueFixture } from '../.claude/skills/verify-build-a-bucket/scripts/league-fixture.mjs';
import { createRunner } from '../.claude/skills/verify-build-a-bucket/scripts/meter/local-pg.mjs';

const catalog = JSON.parse(readFileSync(path.join(process.cwd(), '.claude/skills/verify-build-a-bucket/fixtures/league-fixtures.json'), 'utf8'));
const entry = catalog.entries[0];
const dirs: string[] = [];
const servers: net.Server[] = [];

function startServer(dir: string, failText = '') {
  const log: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let startup = true;
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (startup) {
        if (buffer.length < 4) return;
        const length = buffer.readInt32BE(0) ?? 0;
        if (buffer.length < length) return;
        buffer = buffer.subarray(length);
        startup = false;
        socket.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]));
        socket.write(Buffer.from([0x5a, 0, 0, 0, 5, 0x49]));
      }
      while (buffer.length >= 5) {
        const typeByte = buffer[0] ?? 0;
        const type = String.fromCharCode(typeByte);
        const length = buffer.readInt32BE(1) ?? 0;
        if (buffer.length < length + 1) break;
        const body = buffer.subarray(5, length + 1);
        buffer = buffer.subarray(length + 1);
        if (type === 'Q') {
          const text = body.toString('utf8', 0, body.length - 1);
          log.push(text);
          if (failText && text.includes(failText)) {
            const fields = Buffer.from('SERROR\0C23505\0Mboom\0\0', 'utf8');
            const message = Buffer.alloc(5 + fields.length);
            message[0] = 0x45;
            message.writeInt32BE(4 + fields.length, 1);
            fields.copy(message, 5);
            socket.write(message);
            socket.write(Buffer.from([0x5a, 0, 0, 0, 5, 0x49]));
          } else {
            const ok = Buffer.from('OK\0', 'utf8');
            const message = Buffer.alloc(5 + ok.length);
            message[0] = 0x43;
            message.writeInt32BE(4 + ok.length, 1);
            ok.copy(message, 5);
            socket.write(message);
            socket.write(Buffer.from([0x5a, 0, 0, 0, 5, 0x49]));
          }
        } else if (type === 'X') {
          log.push('terminate');
        }
      }
    });
  });
  server.listen(path.join(dir, '.s.PGSQL.55999'));
  servers.push(server);
  return { server, log, sockets };
}

function runFor(dir: string) {
  return {
    devLocal: true,
    neon: false,
    prod: false,
    supervisorPid: 100,
    postgresPid: 200,
    postmasterPidPath: path.join(dir, 'postmaster.pid'),
    socket: path.join(dir, '.s.PGSQL.55999'),
    socketDir: dir,
    port: 55999,
    database: 'bab',
    readFile: () => ['200', '', '', '55999', dir].join('\n'),
    pidAlive: () => true,
  };
}

async function waitFor(predicate: () => boolean, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('fixture runner close', () => {
  it('commits and closes its own connection', async () => {
    const dir = mkdtempSync('/tmp/bab-fpg-');
    dirs.push(dir);
    const { log, sockets } = startServer(dir);
    await applyLeagueFixture({ entry, run: runFor(dir), secrets: entry.participants.map(() => 's') });
    const expected = 2 + 2 * entry.players + 1;
    expect(log.slice(0, expected)[0]).toBe('begin');
    expect(log[expected - 1]).toBe('commit');
    expect(log.slice(1, expected - 1).every((sql) => sql.startsWith('insert into '))).toBe(true);
    expect(log.slice(1, expected - 1).length).toBe(1 + 2 * entry.players);
    expect(await waitFor(() => log.includes('terminate'))).toBe(true);
    expect(await waitFor(() => sockets.size === 0)).toBe(true);
  });

  it('rolls back, closes and reports the insert failure', async () => {
    const dir = mkdtempSync('/tmp/bab-fpg-');
    dirs.push(dir);
    const { log, sockets } = startServer(dir, 'insert into participants');
    await expect(applyLeagueFixture({ entry, run: runFor(dir), secrets: entry.participants.map(() => 's') })).rejects.toThrow(/boom/);
    expect(log).toContain('rollback');
    expect(await waitFor(() => sockets.size === 0)).toBe(true);
  });

  it('leaves another runner open', async () => {
    const dir = mkdtempSync('/tmp/bab-fpg-');
    dirs.push(dir);
    const { sockets } = startServer(dir);
    const other = await createRunner({ socketDir: dir, port: 55999, database: 'x' });
    await other.query('select 1');
    await applyLeagueFixture({ entry, run: runFor(dir), secrets: entry.participants.map(() => 's') });
    await expect(other.query('select 1')).resolves.toBeDefined();
    expect(sockets.size).toBe(1);
    await other.close();
    expect(await waitFor(() => sockets.size === 0)).toBe(true);
  });

  it('reports cleanup failure honestly', async () => {
    const dir = mkdtempSync('/tmp/bab-fpg-');
    dirs.push(dir);
    startServer(dir);
    const connect = async (target: { socketDir: string; port: number; database: string }) => {
      const runner = await createRunner(target);
      return { ...runner, close: async () => { await runner.close(); throw new Error('close broke'); } };
    };
    await expect(applyLeagueFixture({ entry, run: runFor(dir), connect, secrets: entry.participants.map(() => 's') })).rejects.toThrow(/fixture committed but cleanup failed: close broke/);
    const dir2 = mkdtempSync('/tmp/bab-fpg-');
    dirs.push(dir2);
    startServer(dir2, 'insert into participants');
    const connect2 = async (target: { socketDir: string; port: number; database: string }) => {
      const runner = await createRunner(target);
      return { ...runner, close: async () => { await runner.close(); throw new Error('close broke'); } };
    };
    const error = await applyLeagueFixture({ entry, run: runFor(dir2), connect: connect2, secrets: entry.participants.map(() => 's') }).catch((caught) => caught);
    expect(error.name).toBe('AggregateError');
    expect(error.message).toContain('boom');
    expect(error.message).toContain('close broke');
  });

  it('a one-shot child exits on its own after commit', async () => {
    const dir = mkdtempSync('/tmp/bab-fpg-');
    dirs.push(dir);
    const { log } = startServer(dir);
    const moduleUrl = new URL('../.claude/skills/verify-build-a-bucket/scripts/league-fixture.mjs', import.meta.url).href;
    const code = `import { applyLeagueFixture } from ${JSON.stringify(moduleUrl)}; const args = JSON.parse(process.env.BAB_FIXTURE_ARGS); args.run.pidAlive = () => true; args.run.readFile = () => ['200', '', '', '55999', args.run.socketDir].join('\\n'); await applyLeagueFixture(args); console.log('applied');`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, BAB_FIXTURE_ARGS: JSON.stringify({ entry, run: runFor(dir), secrets: entry.participants.map(() => 's') }) } });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    const exit = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(null); }, 5000);
      child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
    });
    expect(output).toContain('applied');
    expect(exit).toBe(0);
    expect(log).toContain('commit');
    expect(log).toContain('terminate');
  });
});
