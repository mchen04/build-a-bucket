import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { setRunner, type QueryRunner } from '../src/server/db';
import { leagueFor } from '../src/server/lobby';

describe('league cache', () => {
  afterEach(() => setRunner(null));

  it('does not keep a rejected load for the next reader', async () => {
    let calls = 0;
    const runner: QueryRunner = {
      async query<Row>(text: string): Promise<Row[]> {
        if (!text.includes('select league from lobbies')) throw new Error(`unexpected query: ${text}`);
        calls += 1;
        if (calls === 1) throw new Error('db down');
        return [{ league: null }] as unknown as Row[];
      },
      async batch(): Promise<void> {},
    };
    setRunner(runner);
    const lobbyId = randomUUID();
    await expect(leagueFor(lobbyId, 3)).rejects.toThrow('db down');
    await expect(leagueFor(lobbyId, 3)).resolves.toBeNull();
    expect(calls).toBe(2);
  });
});
