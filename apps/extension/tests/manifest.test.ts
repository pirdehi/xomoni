import { describe, expect, it } from 'vitest';
import { CLOUD_URL } from '../src/cloud/config';
import manifestJson from '../public/manifest.json';

const manifest: Record<string, unknown> = manifestJson;

/** The extension pages' Content-Security-Policy as `directive → sources`. */
function csp(): Map<string, string[]> {
  const policy = (manifest.content_security_policy as { extension_pages?: string } | undefined)?.extension_pages ?? '';
  return new Map(
    policy
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name ?? '', sources]),
  );
}

/** Every source file under `src/` with its text, for checks on what the code may call. */
const sources = import.meta.glob<string>('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

describe('the manifest locks the extension down (#143)', () => {
  it('lets extension pages reach only Xomoni’s own API: never X, never anything else (ADR-0002, ADR-0004)', () => {
    expect(csp().get('connect-src')).toEqual(["'self'", CLOUD_URL]);
  });

  it('runs only the extension’s own scripts, with no plugins, frames, forms or base tricks', () => {
    const policy = csp();
    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('script-src')).toEqual(["'self'"]);
    expect(policy.get('worker-src')).toEqual(["'self'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('frame-src')).toEqual(["'none'"]);
    expect(policy.get('form-action')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'none'"]);
    const all = [...policy.values()].flat();
    expect(all).not.toContain("'unsafe-eval'");
    expect(all.filter((s) => s === '*' || s.startsWith('http:') || s.includes('*'))).toEqual([]);
  });

  it('shows images only from itself and X’s picture servers (the account’s avatar)', () => {
    expect(csp().get('img-src')).toEqual([
      "'self'",
      'data:',
      'blob:',
      'https://pbs.twimg.com',
      'https://abs.twimg.com',
    ]);
  });

  it('never runs in incognito, where nothing should be written to this profile', () => {
    expect(manifest.incognito).toBe('not_allowed');
  });

  it('asks for no host access and exposes nothing to web pages', () => {
    expect(manifest).not.toHaveProperty('host_permissions');
    expect(manifest).not.toHaveProperty('web_accessible_resources');
    expect(manifest).not.toHaveProperty('externally_connectable');
    expect(manifest.permissions).toEqual(['storage', 'unlimitedStorage', 'notifications', 'idle', 'power']);
  });

  it('listens to no other extension or web page', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    const external = Object.entries(sources).filter(([, text]) => /onMessageExternal|onConnectExternal/.test(text));
    expect(external.map(([file]) => file)).toEqual([]);
  });
});
