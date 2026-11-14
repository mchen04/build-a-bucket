import { setRunner, type QueryRunner } from '../src/server/db';

if (process.env.BAB_DB_RUNNER) {
  const module = (await import(process.env.BAB_DB_RUNNER)) as { createRunner: () => Promise<QueryRunner> };
  setRunner(await module.createRunner());
}
