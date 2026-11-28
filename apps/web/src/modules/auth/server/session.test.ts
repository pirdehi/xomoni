import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADA_PHONE,
  AT_AAL2,
  NO_FACTORS,
  SIGNED_OUT,
  fakeAuthGateway,
  fakeTwoFactorGateway,
  redirectOf,
} from '@test/server-helpers';
import type { AuthGateway, FactorList } from '../application/ports';
import { authDeps } from './deps';
import {
  currentViewer,
  requireAccount,
  requireSecondFactorStep,
  requireViewer,
  sameSitePath,
  secondFactorPath,
} from './session';

vi.mock('./deps', () => ({ authDeps: vi.fn() }));

function session(overrides: Partial<AuthGateway> = {}, factors: FactorList | null = NO_FACTORS): AuthGateway {
  const gateway = fakeAuthGateway(overrides);
  vi.mocked(authDeps).mockResolvedValue({
    auth: gateway,
    twoFactor: fakeTwoFactorGateway(factors),
    siteUrl: 'http://localhost:3000',
  });
  return gateway;
}

/** Ada's account with an authenticator app (#173). */
const WITH_APP: FactorList = { verified: [ADA_PHONE], unverified: [] };

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

  it('sends a signed-out visitor on the way to the super-admin console to the console’s own sign-in (#516)', async () => {
    for (const returnTo of ['/product', '/product/users?q=ada', '/product/document?v=2']) {
      session(SIGNED_OUT);
      expect(await redirectOf(requireViewer(returnTo))).toBe(`/product/login?next=${encodeURIComponent(returnTo)}`);
    }
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

describe('the session’s assurance level, checked on the server (#173)', () => {
  it('currentViewer is null for a session that owes a code: a password alone is not signed in', async () => {
    session({}, WITH_APP);
    expect(await currentViewer()).toBeNull();
    session(AT_AAL2, WITH_APP);
    expect(await currentViewer()).toEqual(ADA_VIEWER);
  });

  it.each(['/dashboard/reports', '/reset-password', '/connect'])(
    'requireViewer sends an aal1 session of an account with an app from %s to the code page, and back',
    async (page) => {
      session({}, WITH_APP);
      expect(await redirectOf(requireViewer(page))).toBe(`/login/two-factor?next=${encodeURIComponent(page)}`);
    },
  );

  it('requireViewer sends it from the dashboard to the code page, which returns there by default', async () => {
    session({}, WITH_APP);
    expect(await redirectOf(requireViewer('/dashboard'))).toBe('/login/two-factor');
  });

  it('requireViewer lets the same account in after a code (aal2)', async () => {
    session(AT_AAL2, WITH_APP);
    expect(await requireViewer('/dashboard')).toEqual(ADA_VIEWER);
  });

  it('requireViewer lets an account without an app in at aal1, as before', async () => {
    session({}, NO_FACTORS);
    expect(await requireViewer('/dashboard')).toEqual(ADA_VIEWER);
    session({}, { verified: [], unverified: ['f-abandoned'] });
    expect(await requireViewer('/dashboard')).toEqual(ADA_VIEWER);
  });

  it('never reads the claim from anywhere but the verified token: a forged level is aal1', async () => {
    session({ currentClaims: () => Promise.resolve({ sub: 'u1', email: 'ada@example.com', aal: ['aal2'] }) }, WITH_APP);
    expect(await redirectOf(requireViewer('/account'))).toBe('/login/two-factor?next=%2Faccount');
  });

  it('requireAccount sends an aal1 session of an account with an app to the code page before reading it', async () => {
    const gateway = session({}, WITH_APP);
    expect(await redirectOf(requireAccount('/account'))).toBe('/login/two-factor?next=%2Faccount');
    expect(gateway.currentAccount).not.toHaveBeenCalled();
  });

  it('requireAccount returns the account with its apps after a code', async () => {
    session(AT_AAL2, WITH_APP);
    expect(await requireAccount('/account')).toMatchObject({ email: 'ada@example.com', secondFactors: [ADA_PHONE] });
  });

  it('requireSecondFactorStep gives the code page the person who owes a code', async () => {
    session({}, WITH_APP);
    expect(await requireSecondFactorStep('/account')).toEqual(ADA_VIEWER);
  });

  it('requireSecondFactorStep sends someone who owes nothing straight on, same-site only', async () => {
    session(AT_AAL2, WITH_APP);
    expect(await redirectOf(requireSecondFactorStep('/account'))).toBe('/account');
    session({}, NO_FACTORS);
    expect(await redirectOf(requireSecondFactorStep('https://evil.example'))).toBe('/dashboard');
  });

  it('requireSecondFactorStep sends a signed-out visitor to sign in, keeping a same-site next', async () => {
    session(SIGNED_OUT);
    expect(await redirectOf(requireSecondFactorStep('/account'))).toBe('/login?next=%2Faccount');
    session(SIGNED_OUT);
    expect(await redirectOf(requireSecondFactorStep('//evil.example'))).toBe('/login?next=%2Fdashboard');
  });

  it('treats a session the provider no longer knows as signed out', async () => {
    session({}, null);
    expect(await redirectOf(requireViewer('/dashboard'))).toBe('/login?next=%2Fdashboard');
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
      secondFactors: [],
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

describe('sign-in helpers for the console (#516)', () => {
  it('keeps a same-site path and turns anything else into the fallback', () => {
    expect(sameSitePath('/product/users?q=ada', '/product')).toBe('/product/users?q=ada');
    for (const raw of ['https://evil.example/', '//evil.example', '/\\evil.example', null, undefined, '']) {
      expect(sameSitePath(raw, '/product')).toBe('/product');
    }
  });

  it('builds the code page that returns to a console page', () => {
    expect(secondFactorPath('/product')).toBe('/login/two-factor?next=%2Fproduct');
    expect(secondFactorPath('/product/users?q=a&page=2')).toBe(
      '/login/two-factor?next=%2Fproduct%2Fusers%3Fq%3Da%26page%3D2',
    );
  });
});
