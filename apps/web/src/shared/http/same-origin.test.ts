import { describe, expect, it } from 'vitest';
import { crossSiteRefused, isSameOriginRequest } from './same-origin';

const SITE = 'https://xomoni.com';

/** A POST to the site with these headers. */
const post = (headers: Record<string, string>) => new Request(`${SITE}/auth/signout`, { method: 'POST', headers });

describe('isSameOriginRequest (#147)', () => {
  it('accepts a request whose Origin is the site', () => {
    expect(isSameOriginRequest(post({ origin: SITE }), SITE)).toBe(true);
  });

  it.each([
    ['another site', 'https://evil.example'],
    ['a look-alike host', 'https://xomoni.com.evil.example'],
    ['a subdomain', 'https://www.xomoni.com'],
    ['plain HTTP', 'http://xomoni.com'],
    ['another port', 'https://xomoni.com:8443'],
    ['an opaque origin', 'null'],
    ['an empty Origin', ''],
  ])('refuses %s as the Origin', (_name, origin) => {
    expect(isSameOriginRequest(post({ origin }), SITE)).toBe(false);
  });

  it('falls back to Sec-Fetch-Site only when there is no Origin', () => {
    expect(isSameOriginRequest(post({ 'sec-fetch-site': 'same-origin' }), SITE)).toBe(true);
    expect(isSameOriginRequest(post({ 'sec-fetch-site': 'same-site' }), SITE)).toBe(false);
    expect(isSameOriginRequest(post({ 'sec-fetch-site': 'cross-site' }), SITE)).toBe(false);
    expect(isSameOriginRequest(post({ 'sec-fetch-site': 'none' }), SITE)).toBe(false);
    expect(isSameOriginRequest(post({ origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }), SITE)).toBe(
      false,
    );
  });

  it('refuses a request with neither header', () => {
    expect(isSameOriginRequest(post({}), SITE)).toBe(false);
  });
});

describe('crossSiteRefused', () => {
  it('answers 403, uncached, without a redirect', async () => {
    const response = crossSiteRefused();
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toBe('Cross-site request refused.');
  });
});
