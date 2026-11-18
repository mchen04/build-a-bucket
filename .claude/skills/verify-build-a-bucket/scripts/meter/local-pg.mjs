import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const HOST = process.env.BAB_PG_HOST ?? '127.0.0.1';
const PORT = Number(process.env.BAB_PG_PORT ?? 55432);
const SOCKET_DIR = process.env.BAB_PG_SOCKET_DIR ?? '';
const USER = process.env.BAB_PG_USER ?? 'postgres';
const DATABASE = process.env.BAB_PG_DATABASE ?? 'bab_perf';
const LOG = process.env.BAB_DB_METER_LOG ?? '';
const MAX_CONNECTIONS = Number(process.env.BAB_DB_MAX ?? 24);

let pending = [];
let flushTimer = null;

function flush(sync = false) {
  if (!LOG || !pending.length) return;
  const chunk = pending.map((entry) => entry + '\n').join('');
  pending = [];
  if (sync) fs.appendFileSync(LOG, chunk);
  else fs.appendFile(LOG, chunk, () => {});
}

function record(entry) {
  if (!LOG) return;
  entry.t = Date.now();
  pending.push(JSON.stringify(entry));
  if (pending.length >= 128) flush();
  if (!flushTimer) {
    flushTimer = setInterval(flush, 400);
    flushTimer.unref();
  }
}

process.on('exit', () => flush(true));
process.on('beforeExit', () => flush(true));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { flush(true); process.exit(0); });

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function literal(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    const parts = value.map((entry) => `"${String(entry).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    return quote(`{${parts.join(',')}}`);
  }
  if (typeof value === 'object') return quote(JSON.stringify(value));
  return quote(value);
}

function interpolate(text, params) {
  return text.replace(/\$(\d+)/g, (_, index) => literal(params[Number(index) - 1]));
}

function decode(text, oid) {
  if (oid === 16) return text === 't';
  if (oid === 20 || oid === 21 || oid === 23 || oid === 26) return Number(text);
  if (oid === 700 || oid === 701 || oid === 1700) return Number(text);
  if (oid === 114 || oid === 3802) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function parseError(payload) {
  const fields = {};
  let offset = 0;
  while (offset < payload.length) {
    const code = payload[offset];
    if (code === 0) break;
    const end = payload.indexOf(0, offset + 1);
    fields[String.fromCharCode(code)] = payload.toString('utf8', offset + 1, end < 0 ? payload.length : end);
    offset = end < 0 ? payload.length : end + 1;
  }
  const error = new Error(fields.M ?? 'database error');
  error.code = fields.C;
  error.detail = fields.D;
  error.severity = fields.S;
  return error;
}

class Connection {
  constructor(target) {
    this.target = target;
    this.sock = null;
    this.buffer = Buffer.alloc(0);
    this.fields = [];
    this.rows = [];
    this.error = null;
    this.received = 0;
    this.ready = null;
    this.broken = null;
  }

  async open() {
    const socketDir = this.target?.socketDir ?? SOCKET_DIR;
    const port = this.target?.port ?? PORT;
    const database = this.target?.database ?? DATABASE;
    const sock = socketDir ? net.connect({ path: path.join(socketDir, `.s.PGSQL.${port}`) }) : net.connect({ host: HOST, port });
    this.sock = sock;
    await new Promise((resolve, reject) => {
      sock.once('connect', resolve);
      sock.once('error', reject);
    });
    sock.on('data', (chunk) => this.consume(chunk));
    sock.on('error', (error) => {
      this.broken = error;
      const waiter = this.ready;
      this.ready = null;
      waiter?.(error);
    });
    sock.on('close', () => {
      this.broken = this.broken ?? new Error('connection closed');
      const waiter = this.ready;
      this.ready = null;
      waiter?.(this.broken);
    });
    const payload = Buffer.from(`user\0${USER}\0database\0${database}\0\0`, 'utf8');
    const message = Buffer.alloc(8 + payload.length);
    message.writeInt32BE(8 + payload.length, 0);
    message.writeInt32BE(196608, 4);
    payload.copy(message, 8);
    sock.write(message);
    const error = await this.wait();
    if (error) throw error;
  }

  consume(chunk) {
    this.received += chunk.length;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.buffer.length >= 5) {
      const length = this.buffer.readInt32BE(1);
      const total = length + 1;
      if (this.buffer.length < total) break;
      const type = String.fromCharCode(this.buffer[0]);
      const body = this.buffer.subarray(5, total);
      this.buffer = this.buffer.subarray(total);
      this.handle(type, body);
    }
  }

  handle(type, body) {
    if (type === 'R') {
      const code = body.readInt32BE(0);
      if (code !== 0) this.error = new Error(`unsupported authentication request ${code}`);
      return;
    }
    if (type === 'E') {
      this.error = parseError(body);
      return;
    }
    if (type === 'T') {
      const count = body.readInt16BE(0);
      let offset = 2;
      const fields = [];
      for (let index = 0; index < count; index++) {
        const end = body.indexOf(0, offset);
        const name = body.toString('utf8', offset, end);
        const oid = body.readInt32BE(end + 7);
        fields.push({ name, oid });
        offset = end + 1 + 18;
      }
      this.fields = fields;
      return;
    }
    if (type === 'D') {
      const count = body.readInt16BE(0);
      let offset = 2;
      const row = {};
      for (let index = 0; index < count; index++) {
        const field = this.fields[index] ?? { name: `c${index}`, oid: 25 };
        const length = body.readInt32BE(offset);
        offset += 4;
        if (length < 0) {
          row[field.name] = null;
          continue;
        }
        const text = body.toString('utf8', offset, offset + length);
        row[field.name] = decode(text, field.oid);
        offset += length;
      }
      this.rows.push(row);
      return;
    }
    if (type === 'Z') {
      const waiter = this.ready;
      this.ready = null;
      waiter?.(this.error ?? null);
    }
  }

  wait() {
    return new Promise((resolve) => {
      if (this.broken) {
        resolve(this.broken);
        return;
      }
      this.ready = resolve;
    });
  }

  async query(text) {
    if (this.broken) throw this.broken;
    const body = Buffer.from(`${text}\0`, 'utf8');
    const message = Buffer.alloc(5 + body.length);
    message[0] = 0x51;
    message.writeInt32BE(4 + body.length, 1);
    body.copy(message, 5);
    this.fields = [];
    this.rows = [];
    this.error = null;
    const before = this.received;
    const started = performance.now();
    this.sock.write(message);
    const error = await this.wait();
    const ms = performance.now() - started;
    const outcome = {
      ms,
      requestBytes: message.length,
      responseBytes: this.received - before,
      rows: this.rows.length,
      sql: text.replace(/\s+/g, ' ').trim().slice(0, 1200),
      ok: !error,
    };
    const rows = this.rows;
    this.rows = [];
    record(outcome);
    if (error) throw error;
    return rows;
  }

  close() {
    try {
      this.sock?.destroy();
    } catch {
      this.broken = this.broken ?? new Error('close failed');
    }
  }
}

class Pool {
  constructor(max, target) {
    this.max = max;
    this.target = target;
    this.idle = [];
    this.count = 0;
    this.waiting = [];
  }

  async acquire() {
    const free = this.idle.pop();
    if (free && !free.broken) return free;
    if (this.count < this.max) {
      this.count += 1;
      const connection = new Connection(this.target);
      try {
        await connection.open();
        return connection;
      } catch (error) {
        this.count -= 1;
        connection.close();
        throw error;
      }
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  release(connection) {
    if (connection.broken) {
      this.count -= 1;
      const next = this.waiting.shift();
      if (next) next();
      return;
    }
    const next = this.waiting.shift();
    if (next) {
      next(connection);
      return;
    }
    this.idle.push(connection);
  }
}

export async function createRunner(target) {
  const resolved = target ? { socketDir: target.socketDir, port: target.port, database: target.database } : { socketDir: SOCKET_DIR, port: PORT, database: DATABASE };
  const pool = new Pool(MAX_CONNECTIONS, resolved);
  return {
    target: resolved,
    async query(text, params = []) {
      const sql = params.length ? interpolate(text, params) : text;
      const connection = await pool.acquire();
      try {
        return await connection.query(sql);
      } finally {
        pool.release(connection);
      }
    },
    async batch(queries) {
      if (!queries.length) return;
      const connection = await pool.acquire();
      try {
        await connection.query('begin');
        for (const entry of queries) {
          await connection.query(interpolate(entry.text, entry.params ?? []));
        }
        await connection.query('commit');
      } catch (error) {
        try {
          await connection.query('rollback');
        } catch {
          connection.broken = connection.broken ?? new Error('rollback failed');
        }
        throw error;
      } finally {
        pool.release(connection);
      }
    },
    async transaction(queries) {
      if (!queries.length) return [];
      const connection = await pool.acquire();
      try {
        await connection.query('begin');
        const results = [];
        for (const entry of queries) results.push(await connection.query(interpolate(entry.text, entry.params ?? [])));
        await connection.query('commit');
        return results;
      } catch (error) {
        try {
          await connection.query('rollback');
        } catch {
          connection.broken = connection.broken ?? new Error('rollback failed');
        }
        throw error;
      } finally {
        pool.release(connection);
      }
    },
  };
}
