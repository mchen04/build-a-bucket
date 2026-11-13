import { isCode, normalizeCode } from './codes.js';

export function inviteUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/j/${normalizeCode(code)}`;
}

export function parseInvite(input: { pathname: string; search: string }): string | null {
  const params = new URLSearchParams(input.search);
  const query = params.get('join');
  if (query && isCode(query)) return normalizeCode(query);
  const match = input.pathname.match(/^\/j\/([^/]+)\/?$/);
  if (match?.[1] && isCode(match[1])) return normalizeCode(match[1]);
  return null;
}
