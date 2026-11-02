import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// site.ts resolves its values once, at import; each test imports a fresh copy.
const load = () => import('./site');

beforeEach(() => {
  vi.resetModules();
  // Vercel sets this on every deployment; start each test without it.
  vi.stubEnv('NEXT_PUBLIC_VERCEL_URL', undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('SITE_URL', () => {
  it('uses NEXT_PUBLIC_SITE_URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://xomoni.com');
    expect((await load()).SITE_URL).toBe('https://xomoni.com');
  });

  it('drops trailing slashes, so return URLs never get a double slash', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://xomoni.com///');
    const { SITE_URL } = await load();

    expect(SITE_URL).toBe('https://xomoni.com');
    expect(new URL('/auth/callback', SITE_URL).href).toBe('https://xomoni.com/auth/callback');
  });

  it('prefers the explicit address over a Vercel preview URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://xomoni.com');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_URL', 'xomoni-git-feature-pirdehi.vercel.app');

    expect((await load()).SITE_URL).toBe('https://xomoni.com');
  });

  it.each([undefined, ''])(
    'falls back to the preview deployment’s own URL over HTTPS when NEXT_PUBLIC_SITE_URL is %j',
    async (explicit) => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', explicit);
      vi.stubEnv('NEXT_PUBLIC_VERCEL_URL', 'xomoni-git-feature-pirdehi.vercel.app');

      expect((await load()).SITE_URL).toBe('https://xomoni-git-feature-pirdehi.vercel.app');
    },
  );

  it('fails clearly when neither is set, instead of building return URLs on a guess', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_VERCEL_URL', '');

    await expect(load()).rejects.toThrow(
      'Missing NEXT_PUBLIC_SITE_URL: copy apps/web/.env.example to apps/web/.env.local, or set it in Vercel.',
    );
  });
});

describe('TURNSTILE_SITE_KEY', () => {
  it('uses the configured site key', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '0x4AAAAAAA-live');
    expect((await load()).TURNSTILE_SITE_KEY).toBe('0x4AAAAAAA-live');
  });

  it.each([undefined, ''])('fails clearly when it is %j', async (value) => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', value);
    await expect(load()).rejects.toThrow('Missing NEXT_PUBLIC_TURNSTILE_SITE_KEY');
  });
});

describe('public links', () => {
  it('point at the personal open-source repository and the privacy contact', async () => {
    const site = await load();

    expect(site.GITHUB_URL).toBe('https://github.com/pirdehi/xomoni');
    expect(site.INSTALL_URL).toBe('https://github.com/pirdehi/xomoni#install');
    expect(site.ISSUES_URL).toBe('https://github.com/pirdehi/xomoni/issues');
    expect(site.CONTACT_EMAIL).toBe('privacy@xomoni.com');
  });
});
