import { describe, expect, it, vi } from 'vitest';
import { serverError } from '../src/server/db';

describe('server error bodies', () => {
  it('keeps database text out of the response', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const body = serverError(new Error('relation "lobbies" does not exist (character 15)'));
      expect(body.reason).toBe('server');
      expect(body.error).toBe('Something went wrong on the server.');
      expect(JSON.stringify(body)).not.toMatch(/relation|lobbies|character|\berror:/i);
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});
