import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { db, type QueryRunner } from '../src/server/db.ts';

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadLocalEnv(dir = process.cwd()): void {
  const file = process.env.BAB_ENV_FILE ?? path.join(dir, '.env.local');
  if (!existsSync(file)) return;
  const parsed = parseEnvFile(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function neonClient(): QueryRunner {
  loadLocalEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set in the environment or .env.local');
  }
  return db();
}

export function statementsFrom(source: string): string[] {
  const cleaned = source
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return cleaned
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
