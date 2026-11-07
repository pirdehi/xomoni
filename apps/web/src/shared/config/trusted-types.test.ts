import { describe, expect, it, vi } from 'vitest';
import {
  SITE_BUNDLES,
  TRUSTED_TYPES_POLICY,
  TURNSTILE_LOADER,
  type TrustedTypesHost,
  type TrustedTypesRules,
  installTrustedTypesPolicy,
} from './trusted-types';

const ORIGIN = 'https://xomoni.com';

/** Installs the policy on a fake window, the way `instrumentation-client.ts` does, and returns the policies made. */
function install(trustedTypes?: TrustedTypesHost['trustedTypes']): Map<string, TrustedTypesRules> {
  const policies = new Map<string, TrustedTypesRules>();
  const fake = {
    createPolicy(name: string, rules: TrustedTypesRules) {
      if (policies.has(name)) throw new TypeError(`policy ${name} exists`);
      policies.set(name, rules);
      return rules;
    },
  };
  const host: TrustedTypesHost = {
    trustedTypes: trustedTypes === undefined ? fake : trustedTypes,
    location: { origin: ORIGIN },
    document: { baseURI: `${ORIGIN}/risks` },
  };
  installTrustedTypesPolicy(host);
  return policies;
}

/** The site's one policy. */
function policy(): TrustedTypesRules {
  const made = install();
  expect([...made.keys()]).toEqual([TRUSTED_TYPES_POLICY]);
  return made.get(TRUSTED_TYPES_POLICY)!;
}

describe('the Trusted Types policy (#147)', () => {
  it('creates one policy, named default, so string sinks go through it', () => {
    expect(TRUSTED_TYPES_POLICY).toBe('default');
    // No createScript: `eval` and script text stay refused.
    expect(Object.keys(policy()).sort()).toEqual(['createHTML', 'createScriptURL']);
  });

  it.each([
    ['a bundle path, as Turbopack loads it', '/_next/static/chunks/2r0pgruapmhin.js'],
    ['the same bundle as an absolute URL', `${ORIGIN}/_next/static/chunks/2r0pgruapmhin.js`],
    ['Turnstile’s loader with its query', `${TURNSTILE_LOADER}api.js?onload=cb&render=explicit`],
  ])('lets %s through unchanged', (_name, url) => {
    // Unchanged matters: Turbopack finds a loaded bundle again by the exact `src` it set.
    expect(policy().createScriptURL(url)).toBe(url);
  });

  it.each([
    ['another path on the site', '/api/csp-report'],
    ['a path that only starts like the bundles', '/_next/staticky/x.js'],
    ['a bundle path on another site', `https://evil.example${SITE_BUNDLES}x.js`],
    ['a protocol-relative URL to another site', `//evil.example${SITE_BUNDLES}x.js`],
    ['the site over plain HTTP', `http://xomoni.com${SITE_BUNDLES}x.js`],
    ['another script on Cloudflare’s challenge host', 'https://challenges.cloudflare.com/cdn-cgi/x.js'],
    ['a look-alike of Turnstile’s host', 'https://challenges.cloudflare.com.evil.example/turnstile/v0/api.js'],
    ['a data: URL', 'data:text/javascript,alert(1)'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a blob: URL', `blob:${ORIGIN}/0b1c`],
    ['something that isn’t a URL', 'http://[::1'],
  ])('refuses %s as a script URL', (_name, url) => {
    expect(policy().createScriptURL(url)).toBeNull();
  });

  it.each([
    ['style text, as Next.js’s error page sets it', ':root { --next-error-bg: #fff; } body { margin: 0 }'],
    ['plain text', 'Hello & welcome'],
  ])('lets %s through as HTML', (_name, html) => {
    expect(policy().createHTML(html)).toBe(html);
  });

  it.each([
    ['an image with an error handler', '<img src=x onerror=alert(1)>'],
    ['a script with code', '<script>alert(1)</script>'],
    ['an empty script', '<script></script>'],
    ['an iframe', '<iframe srcdoc="x"></iframe>'],
    ['markup after text', 'hello <b>world</b>'],
  ])('refuses %s as HTML', (_name, html) => {
    expect(policy().createHTML(html)).toBeNull();
  });

  it('does nothing in a browser without Trusted Types', () => {
    expect(install(null).size).toBe(0);
    expect(() => install({} as TrustedTypesHost['trustedTypes'])).not.toThrow();
  });

  it('resolves relative URLs against the page’s base URL at the time of use', () => {
    let base = `${ORIGIN}/risks`;
    const made = new Map<string, TrustedTypesRules>();
    installTrustedTypesPolicy({
      trustedTypes: { createPolicy: (name, rules) => made.set(name, rules) },
      location: { origin: ORIGIN },
      document: {
        get baseURI() {
          return base;
        },
      },
    });
    const rules = made.get(TRUSTED_TYPES_POLICY)!;
    expect(rules.createScriptURL('../_next/static/x.js')).toBe('../_next/static/x.js');
    base = 'https://evil.example/';
    expect(rules.createScriptURL('/_next/static/x.js')).toBeNull();
  });
});

describe('a default policy made before the site’s (#178)', () => {
  it('keeps it, warns, and lets the page start instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // An extension running in the page made `default` first; the browser refuses a second one.
    const taken = {
      createPolicy: vi.fn(() => {
        throw new TypeError('Policy with name "default" already exists.');
      }),
    };
    const host: TrustedTypesHost = {
      trustedTypes: taken,
      location: { origin: ORIGIN },
      document: { baseURI: `${ORIGIN}/login` },
    };

    expect(() => installTrustedTypesPolicy(host)).not.toThrow();
    expect(installTrustedTypesPolicy(host)).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('another default Trusted Types policy'),
      expect.any(TypeError),
    );
    warn.mockRestore();
  });

  it('says when the site’s own policy is the one in place', () => {
    const host: TrustedTypesHost = {
      trustedTypes: { createPolicy: () => ({}) },
      location: { origin: ORIGIN },
      document: { baseURI: `${ORIGIN}/login` },
    };
    expect(installTrustedTypesPolicy(host)).toBe(true);
    expect(installTrustedTypesPolicy({ ...host, trustedTypes: null })).toBe(false);
  });
});
