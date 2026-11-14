import { neon } from '@neondatabase/serverless';
import type { ApiErrorBody } from '../shared/mp/types.js';

export interface BatchQuery {
  text: string;
  params: unknown[];
}

export interface QueryRunner {
  query<Row>(text: string, params?: unknown[]): Promise<Row[]>;
  batch(queries: BatchQuery[]): Promise<void>;
}

let runner: QueryRunner | null = null;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  return url;
}

export function db(): QueryRunner {
  if (!runner) {
    const client = neon(databaseUrl());
    runner = {
      async query<Row>(text: string, params: unknown[] = []): Promise<Row[]> {
        const rows = await client.query(text, params);
        return rows as unknown as Row[];
      },
      async batch(queries: BatchQuery[]): Promise<void> {
        if (!queries.length) return;
        await client.transaction((txn) => queries.map((entry) => txn.query(entry.text, entry.params)));
      },
    };
  }
  return runner;
}

export function setRunner(next: QueryRunner | null): void {
  runner = next;
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export function serverError(error: unknown): ApiErrorBody {
  console.error('lobby request failed:', error);
  return { error: 'Something went wrong on the server.', reason: 'server' };
}
