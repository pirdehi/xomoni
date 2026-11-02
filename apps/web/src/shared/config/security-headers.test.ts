import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from './security-headers';

const PRODUCTION = { supabaseUrl: 'https://abcd.supabase.co', siteUrl: 'https://xomoni.com', dev: false };
const LOCAL = { supabaseUrl: 'http://127.0.0.1:54321', siteUrl: 'http://localhost:3000', dev: true };

/** The policy as a map from directive to its sources. */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split('; ').map((part) => {
      const [name = '', ...sources] = part.split(' ');
      return [name, sources];
    }),
  );
}

describe('content security policy (#8)', () => {
  it('lets the browser reach only the site and its own Supabase project, Realtime included', () => {
    expect(directives(contentSecurityPolicy(PRODUCTION)).get('connect-src')).toEqual([
      "'self'",
      'https://abcd.supabase.co',
      'wss://abcd.supabase.co',
    ]);
    expect(directives(contentSecurityPolicy(LOCAL)).get('connect-src')).toEqual([
      "'self'",
      'http://127.0.0.1:54321',
      'ws://127.0.0.1:54321',
    ]);
  });

  it('loads scripts only from the site and Turnstile, and never allows eval in production', () => {
    const production = directives(contentSecurityPolicy(PRODUCTION));
    expect(production.get('script-src')).toEqual(["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com']);
    expect(production.get('frame-src')).toEqual(['https://challenges.cloudflare.com']);
    expect(contentSecurityPolicy(PRODUCTION)).not.toContain('unsafe-eval');
    expect(directives(contentSecurityPolicy(LOCAL)).get('script-src')).toContain("'unsafe-eval'");
  });

  it('forbids framing, plugins, base-URL changes and posting forms elsewhere', () => {
    const policy = directives(contentSecurityPolicy(PRODUCTION));
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'self'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
    expect(policy.get('default-src')).toEqual(["'self'"]);
  });

  it('upgrades insecure requests over HTTPS, and on previews where the site URL is unset, but not locally', () => {
    expect(directives(contentSecurityPolicy(PRODUCTION)).has('upgrade-insecure-requests')).toBe(true);
    expect(
      directives(contentSecurityPolicy({ ...PRODUCTION, siteUrl: undefined })).has('upgrade-insecure-requests'),
    ).toBe(true);
    expect(directives(contentSecurityPolicy(LOCAL)).has('upgrade-insecure-requests')).toBe(false);
  });

  it('fails loudly on a missing or malformed Supabase URL instead of shipping an open policy', () => {
    expect(() => contentSecurityPolicy({ ...PRODUCTION, supabaseUrl: '' })).toThrow();
    expect(() => contentSecurityPolicy({ ...PRODUCTION, supabaseUrl: 'abcd.supabase.co' })).toThrow();
  });
});

describe('security headers (#8)', () => {
  it('sends the policy with the other protections on every response', () => {
    const headers = new Map(securityHeaders(PRODUCTION).map(({ key, value }) => [key, value]));
    expect(headers.get('Content-Security-Policy')).toBe(contentSecurityPolicy(PRODUCTION));
    expect(headers.get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    expect(headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });
});
