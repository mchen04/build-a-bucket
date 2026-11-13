import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, cleanName, generateCode, generateSecret, hashSecret, isCode, normalizeCode } from '../src/shared/mp/codes';

describe('lobby codes', () => {
  it('generates six character codes from the safe alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const value = generateCode();
      expect(value).toHaveLength(6);
      expect(value).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      seen.add(value);
    }
    expect(seen.size).toBeGreaterThan(190);
    for (const char of ['I', 'O', '0', '1']) {
      expect(CODE_ALPHABET).not.toContain(char);
    }
  });

  it('normalises codes typed by hand', () => {
    expect(normalizeCode(' ab-c23 ')).toBe('ABC23');
    expect(isCode(normalizeCode('abcd23'))).toBe(true);
    expect(isCode('ABCDI0')).toBe(false);
    expect(isCode('ABC')).toBe(false);
  });

  it('hashes secrets reproducibly', async () => {
    const secret = generateSecret();
    const hash = await hashSecret(secret);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(secret);
    expect(await hashSecret(secret)).toBe(hash);
    expect(await hashSecret(generateSecret())).not.toBe(hash);
  });

  it('cleans names', () => {
    expect(cleanName('  Mike\u0007 ')).toBe('Mike');
    expect(cleanName('')).toBe('');
    expect(cleanName('x'.repeat(40))).toHaveLength(16);
  });
});
