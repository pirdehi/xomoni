import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGNED_OUT, fakeAuthGateway, redirectOf } from '@test/server-helpers';
import type { AuthGateway } from '../application/ports';
import { authDeps } from './deps';
import { currentViewer, requireAccount, requireViewer } from './session';

vi.mock('./deps', () => ({ authDeps: vi.fn() }));

function session(overrides: Partial<AuthGateway> = {}): AuthGateway {
  const gateway = fakeAuthGateway(overrides);
  vi.mocked(authDeps).mockResolvedValue({ auth: gateway, siteUrl: 'http://localhost:3000' });
  return gateway;
}

/** The `next` query parameter of a same-site redirect destination, checking it stays on the sign-in page. */
function signInNext(destination: string): string | null {
  const url = new URL(destination, 'https://xomoni.test');
  expect(url.origin).toBe('https://xomoni.test');
  expect(url.pathname).toBe('/login');
  expect([...url.searchParams.keys()]).toEqual(['next']);
  return url.searchParams.get('next');
}

const ADA_VIEWER = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  avatarUrl: null,
  signInMethods: ['email'],
};

beforeEach(() => {
  vi.mocked(authDeps).mockReset();
});

describe('currentViewer', () => {
  it('returns the viewer built from the verified claims', async () => {
    session();
    expect(await currentViewer()).toEqual(ADA_VIEWER);
  });

  it('returns null for a signed-out visitor', async () => {
    session(SIGNED_OUT);
    expect(await currentViewer()).toBeNull();
  });

  it('reads the session of the current request every time', async () => {
    session();
    await currentViewer();
    session(SIGNED_OUT);
    expect(await currentViewer()).toBeNull();
    expect(authDeps).toHaveBeenCalledTimes(2);
  });
});

describe('requireViewer', () => {
  it('returns the signed-in viewer without redirecting', async () => {
    session();
    expect(await requireViewer('/dashboard')).toEqual(ADA_VIEWER);
  });

  it('sends a signed-out visitor to sign in, then back to the page that asked', async () => {
    session(SIGNED_OUT);
    const destination = await redirectOf(requireViewer('/dashboard'));
    expect(destination).toBe('/login?next=%2Fdashboard');
  });

  it('sends a signed-out visitor to plain sign in when there is nowhere to return to', async () => {
    session(SIGNED_OUT);
    expect(await redirectOf(requireViewer())).toBe('/login');
    session(SIGNED_OUT);
    expect(await redirectOf(requireViewer(''))).toBe('/login');
  });

  it('encodes the return path, so its query and fragment can’t add parameters to the sign-in URL', async () => {
    session(SIGNED_OUT);
    const returnTo = '/dashboard?tab=jobs&next=https://evil.example#top';

    const destination = await redirectOf(requireViewer(returnTo));

    expect(signInNext(destination)).toBe(returnTo);
  });

  it('always redirects to this site’s sign-in page, whatever it is asked to return to', async () => {
    for (const returnTo of ['https://evil.example/', '//evil.example', '/\\evil.example']) {
      session(SIGNED_OUT);
      const destination = await redirectOf(requireViewer(returnTo));
      // The sign-in page passes `next` through safeNextPath before following it.
      expect(signInNext(destination)).toBe(returnTo);
    }
  });
});

describe('requireAccount', () => {
  it('returns the viewer with the current and pending email from the provider', async () => {
    session({
      currentAccount: () => Promise.resolve({ email: 'ada@new.example', pendingEmail: 'ada@newer.example' }),
    });

    expect(await requireAccount('/account')).toEqual({
      ...ADA_VIEWER,
      email: 'ada@new.example',
      pendingEmail: 'ada@newer.example',
    });
  });

  it('sends a signed-out visitor to sign in and back to the account page', async () => {
    session(SIGNED_OUT);
    expect(await redirectOf(requireAccount('/account'))).toBe('/login?next=%2Faccount');
  });

  it('treats valid claims without an account record (deleted elsewhere) as signed out', async () => {
    const gateway = session({ currentAccount: () => Promise.resolve(null) });

    expect(await redirectOf(requireAccount('/account'))).toBe('/login?next=%2Faccount');
    expect(gateway.currentClaims).toHaveBeenCalled();
  });

  it('treats an account record without verified claims as signed out', async () => {
    session({ currentClaims: () => Promise.resolve(null) });
    expect(await redirectOf(requireAccount('/account?tab=security'))).toBe('/login?next=%2Faccount%3Ftab%3Dsecurity');
  });
});
