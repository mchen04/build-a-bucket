export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, '');
}

export function isCode(input: string): boolean {
  return CODE_PATTERN.test(normalizeCode(input));
}

export function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length] ?? 'A';
  }
  return code;
}

export function generateSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function newActionId(): string {
  return crypto.randomUUID();
}

export async function hashSecret(secret: string): Promise<string> {
  const data = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function cleanName(input: string): string {
  const printable = [...input].filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code > 31 && code !== 127;
  });
  return printable.join('').trim().slice(0, 16);
}
