import { describe, expect, it } from 'vitest';
import { inviteUrl, parseInvite } from '../src/shared/mp/invite';

describe('invite links', () => {
  it('builds a shareable URL that carries the code', () => {
    expect(inviteUrl('https://build-a-bucket.vercel.app', 'abc234')).toBe('https://build-a-bucket.vercel.app/j/ABC234');
    expect(inviteUrl('https://build-a-bucket.vercel.app/', 'ABC234')).toBe('https://build-a-bucket.vercel.app/j/ABC234');
  });

  it('parses query and path invites', () => {
    expect(parseInvite({ pathname: '/', search: '?join=abc234' })).toBe('ABC234');
    expect(parseInvite({ pathname: '/j/abc234', search: '' })).toBe('ABC234');
    expect(parseInvite({ pathname: '/j/abc234/', search: '' })).toBe('ABC234');
    expect(parseInvite({ pathname: '/', search: '?join=ABC-234' })).toBe('ABC234');
  });

  it('ignores malformed or missing invites', () => {
    expect(parseInvite({ pathname: '/', search: '?join=bad' })).toBeNull();
    expect(parseInvite({ pathname: '/j/bad', search: '' })).toBeNull();
    expect(parseInvite({ pathname: '/', search: '' })).toBeNull();
    expect(parseInvite({ pathname: '/j/', search: '' })).toBeNull();
  });
});
