import { describe, expect, it } from 'vitest';
import { parseEmailLink } from './email-link';

const tokenHash = 'f'.repeat(56);

describe('parseEmailLink', () => {
  it('accepts each link type and picks its default destination', () => {
    expect(parseEmailLink({ token_hash: tokenHash, type: 'email' })).toEqual({
      tokenHash,
      type: 'email',
      next: '/dashboard',
    });
    expect(parseEmailLink({ token_hash: tokenHash, type: 'recovery' })?.next).toBe('/reset-password');
    expect(parseEmailLink({ token_hash: tokenHash, type: 'email_change' })?.next).toBe('/account?email=confirmed');
  });

  it('maps legacy names', () => {
    expect(parseEmailLink({ token_hash: tokenHash, type: 'signup' })?.type).toBe('email');
    expect(parseEmailLink({ token_hash: tokenHash, type: 'magiclink' })?.type).toBe('email');
  });

  it('keeps next on this site', () => {
    expect(parseEmailLink({ token_hash: tokenHash, type: 'email', next: '/account' })?.next).toBe('/account');
    expect(parseEmailLink({ token_hash: tokenHash, type: 'email', next: '//evil.example' })?.next).toBe('/dashboard');
  });

  it.each([
    ['missing token', { type: 'email' }],
    ['short token', { token_hash: 'abc', type: 'email' }],
    ['token with odd characters', { token_hash: `${tokenHash}<script>`, type: 'email' }],
    ['unknown type', { token_hash: tokenHash, type: 'phone_change' }],
    ['missing type', { token_hash: tokenHash }],
  ])('rejects a link with %s', (_label, query) => {
    expect(parseEmailLink(query)).toBeNull();
  });
});
