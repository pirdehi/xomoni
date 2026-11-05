import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AVATAR_HOST } from '@/modules/auth/domain/viewer';
import {
  CSP_REPORT_PATH,
  EMBEDDABLE_PATHS,
  GOOGLE_AVATARS,
  contentSecurityPolicy,
  embeddableHeaders,
  securityHeaders,
} from './security-headers';

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

describe('Trusted Types, reports, images and resource policy (#147)', () => {
  it('requires Trusted Types for every script sink and allows only the site’s default policy', () => {
    const policy = directives(contentSecurityPolicy(PRODUCTION));
    expect(policy.get('require-trusted-types-for')).toEqual(["'script'"]);
    expect(policy.get('trusted-types')).toEqual(['default']);
  });

  it('leaves Trusted Types out of next dev, which needs eval', () => {
    const policy = directives(contentSecurityPolicy(LOCAL));
    expect(policy.has('require-trusted-types-for')).toBe(false);
    expect(policy.has('trusted-types')).toBe(false);
  });

  it('reports violations to the site, through the Reporting API and the older report-uri', () => {
    for (const settings of [PRODUCTION, LOCAL]) {
      const policy = directives(contentSecurityPolicy(settings));
      expect(policy.get('report-uri')).toEqual([CSP_REPORT_PATH]);
      expect(policy.get('report-to')).toEqual(['csp']);
    }
    const headers = new Map(securityHeaders(PRODUCTION).map(({ key, value }) => [key, value]));
    expect(headers.get('Reporting-Endpoints')).toBe(`csp="${CSP_REPORT_PATH}"`);
    expect(CSP_REPORT_PATH).toBe('/api/csp-report');
  });

  it('loads images only from the site, data: URLs and Google’s avatar host, the one the dashboard accepts', () => {
    expect(directives(contentSecurityPolicy(PRODUCTION)).get('img-src')).toEqual([
      "'self'",
      'data:',
      'https://lh3.googleusercontent.com',
    ]);
    expect(GOOGLE_AVATARS).toBe(AVATAR_HOST);
  });

  it('keeps every response to the site itself, except the files mail apps embed', () => {
    const headers = new Map(securityHeaders(PRODUCTION).map(({ key, value }) => [key, value]));
    expect(headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(embeddableHeaders()).toEqual([{ key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' }]);
  });

  it('marks as embeddable every site file the auth emails load', () => {
    const templates = path.join(__dirname, '..', '..', '..', '..', '..', 'supabase', 'templates');
    const loaded = new Set<string>();
    for (const name of readdirSync(templates)) {
      const html = readFileSync(path.join(templates, name), 'utf8');
      for (const [, url] of html.matchAll(/src="(https:\/\/xomoni\.com[^"]*)"/g)) loaded.add(new URL(url!).pathname);
    }
    expect(loaded.size).toBeGreaterThan(0);
    for (const file of loaded) expect(EMBEDDABLE_PATHS).toContain(file);
  });
});
