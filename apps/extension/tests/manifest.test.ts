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

  it('asks for no host access and exposes nothing to web pages but a channel from xomoni.com (ADR-0024)', () => {
    expect(manifest).not.toHaveProperty('host_permissions');
    expect(manifest).not.toHaveProperty('web_accessible_resources');
    // Only xomoni.com's own pages may send, and no other extension (no `ids`); it adds no permission warning.
    expect(manifest.externally_connectable).toEqual({ matches: ['https://xomoni.com/*'] });
    // `downloads` only saves X's archive in Downloads/Xomoni, the one folder Chrome lets Xomoni read (#196).
    expect(manifest.permissions).toEqual([
      'storage',
      'unlimitedStorage',
      'notifications',
      'idle',
      'power',
      'downloads',
    ]);
  });

  it('uses the downloads permission only to choose where X’s archive is saved', () => {
    const uses = Object.entries(sources).filter(([, text]) => /chrome\.downloads\./.test(text));
    expect(uses.map(([file]) => file).sort()).toEqual(
      Object.keys(sources)
        .filter((file) => /background\/sw\.ts$|ui\/downloads-folder\.ts$/.test(file))
        .sort(),
    );
    const calls = Object.values(sources).flatMap((text) => text.match(/chrome\.downloads\.\w+/g) ?? []);
    expect([...new Set(calls)].sort()).toEqual([
      'chrome.downloads.download',
      'chrome.downloads.erase',
      'chrome.downloads.onDeterminingFilename',
      'chrome.downloads.search',
    ]);
  });

  it('uses every permission it asks for, and each only where docs/STORE-LISTING.md says (#301)', () => {
    // Each permission's API, and the files that may call it. The stores ask why each permission is needed, and an
    // unused one must go: a permission no code uses fails here, and so does a use outside the files named.
    const uses: Record<string, { api: RegExp; files: RegExp }> = {
      storage: { api: /chrome\.storage\./, files: /(background\/sw|engine\/worker-tab|cloud\/connection)\.ts$/ },
      notifications: {
        api: /chrome(?: as Partial<typeof chrome>\))?\.notifications\b/,
        files: /(background\/sw|shared\/notify)\.ts$/,
      },
      idle: { api: /chrome\.idle\./, files: /engine\/presence\.ts$/ },
      power: { api: /chrome\.power\./, files: /engine\/presence\.ts$/ },
      downloads: { api: /chrome\.downloads\./, files: /(background\/sw|ui\/downloads-folder)\.ts$/ },
      // No API: it lifts the quota on the IndexedDB database the inventory and the log live in, so Chrome never
      // evicts them under storage pressure.
      unlimitedStorage: { api: /class XomoniDB extends Dexie/, files: /shared\/db\.ts$/ },
    };
    expect(Object.keys(uses).sort()).toEqual([...(manifest.permissions as string[])].sort());
    for (const [permission, { api, files }] of Object.entries(uses)) {
      const using = Object.keys(sources).filter((file) => api.test(sources[file] ?? ''));
      expect(using.length, permission).toBeGreaterThan(0);
      expect(
        using.filter((file) => !files.test(file)),
        permission,
      ).toEqual([]);
    }
  });

  it('fits the stores’ limits on the name and the summary, which they take from the manifest (#301)', () => {
    // Chrome: name at most 75 characters, short_name 12 and description 132; Edge shows the description as the
    // short description.
    expect((manifest.name as string).length).toBeLessThanOrEqual(75);
    expect((manifest.short_name as string).length).toBeLessThanOrEqual(12);
    expect((manifest.description as string).length).toBeLessThanOrEqual(132);
  });

  it('listens to no other extension or web page, but the service worker to xomoni.com’s one-time code (#228)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    const external = Object.entries(sources).filter(([, text]) => /onMessageExternal|onConnectExternal/.test(text));
    expect(external.map(([file]) => file)).toEqual([expect.stringMatching(/background\/sw\.ts$/)]);
    expect(Object.values(sources).some((text) => /onConnectExternal/.test(text))).toBe(false);
  });
});

describe('the manifest names the product (#312)', () => {
  it('as Xomoni, the digital footprint manager, within the stores’ limits', () => {
    expect(manifest.name).toBe('Xomoni — Digital footprint manager');
    expect(manifest.short_name).toBe('Xomoni');
    expect(String(manifest.name).length).toBeLessThanOrEqual(75);
    expect(String(manifest.description).length).toBeLessThanOrEqual(132);
  });

  it('never as a platform’s own product: the name and summary don’t present Xomoni as an X account tool', () => {
    for (const text of [manifest.name, manifest.description].map(String)) {
      expect(text).not.toMatch(/X account manager/i);
      expect(text).not.toMatch(/twitter/i);
    }
    expect(String(manifest.description)).toMatch(/^Manage your digital footprint/);
  });
});
