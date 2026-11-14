import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POST } from '../api/lobby/[code]/[action]';
import { ACTION_HANDLERS } from '../src/server/actions';

const client = readFileSync('src/app/mp/api.ts', 'utf8');
const actions = [
  ...new Set([...client.matchAll(/\/api\/lobby\/\$\{code\}\/([a-z]+)/g)].map((match) => match[1] as string)),
].sort();

describe('lobby action dispatch', () => {
  it('routes every client action path to a handler', async () => {
    expect(actions).toEqual(Object.keys(ACTION_HANDLERS).sort());
    for (const action of actions) {
      const response = await POST(new Request(`http://localhost/api/lobby/ABC234/${action}`, { method: 'POST' }));
      expect(response.status).not.toBe(404);
    }
  });

  it('rejects an unknown action', async () => {
    const response = await POST(new Request('http://localhost/api/lobby/ABC234/nope', { method: 'POST' }));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ reason: 'not_found' });
  });

  it('keeps the api function count under 12', () => {
    const files = readdirSync('api', { recursive: true }).filter((entry) => typeof entry === 'string' && entry.endsWith('.ts'));
    expect(files.length).toBeLessThanOrEqual(12);
  });
});
