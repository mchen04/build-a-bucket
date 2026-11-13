import { neon } from '@neondatabase/serverless';

export interface QueryRunner {
  query<Row>(text: string, params?: unknown[]): Promise<Row[]>;
}

let runner: QueryRunner | null = null;

export function databaseUrl(): string {
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
    };
  }
  return runner;
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unexpected error';
}
