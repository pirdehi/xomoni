import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAuthGateway } from '@test/server-helpers';
import { createBrowserSupabase, type BrowserSupabase } from '@/shared/supabase/browser';
import * as useCases from '../application/use-cases';
import { createSupabaseAuthGateway } from '../infrastructure/supabase-auth-gateway';
import { browserAuth } from './auth';

vi.mock('@/shared/supabase/browser', () => ({ createBrowserSupabase: vi.fn() }));
vi.mock('../infrastructure/supabase-auth-gateway', () => ({ createSupabaseAuthGateway: vi.fn() }));
vi.mock('../application/use-cases', () => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  requestPasswordReset: vi.fn(),
  resendConfirmation: vi.fn(),
  confirmEmailLink: vi.fn(),
  setNewPassword: vi.fn(),
  changePassword: vi.fn(),
  changeEmail: vi.fn(),
  startOAuthSignIn: vi.fn(),
}));

const browserClient: object = { auth: {} };
const gateway = fakeAuthGateway();
const deps = { auth: gateway, siteUrl: 'http://localhost:3000' };
const form = { email: 'ada@example.com', password: 'correct horse 42', captchaToken: 'turnstile-token' };

beforeEach(() => {
  vi.mocked(createBrowserSupabase)
    .mockReset()
    .mockReturnValue(browserClient as BrowserSupabase);
  vi.mocked(createSupabaseAuthGateway).mockReset().mockReturnValue(gateway);
});

describe('browserAuth (browser composition root)', () => {
  // Each method, the use case it must call, and the arguments that use case must get after `deps`.
  const cases: [
    name: keyof typeof browserAuth,
    call: () => Promise<unknown>,
    useCase: (...args: never[]) => unknown,
    args: unknown[],
  ][] = [
    ['signUp', () => browserAuth.signUp(form), useCases.signUp, [form]],
    ['signIn', () => browserAuth.signIn(form), useCases.signInWithPassword, [form]],
    ['requestPasswordReset', () => browserAuth.requestPasswordReset(form), useCases.requestPasswordReset, [form]],
    ['resendConfirmation', () => browserAuth.resendConfirmation(form), useCases.resendConfirmation, [form]],
    [
      'confirmEmailLink',
      () => browserAuth.confirmEmailLink({ token_hash: 'pkce_abc', type: 'signup', next: '/dashboard' }),
      useCases.confirmEmailLink,
      [{ token_hash: 'pkce_abc', type: 'signup', next: '/dashboard' }],
    ],
    ['setNewPassword', () => browserAuth.setNewPassword(form), useCases.setNewPassword, [form]],
    ['changePassword', () => browserAuth.changePassword(form), useCases.changePassword, [form]],
    ['changeEmail', () => browserAuth.changeEmail(form), useCases.changeEmail, [form]],
    [
      'startGoogleSignIn',
      () => browserAuth.startGoogleSignIn('/account'),
      useCases.startOAuthSignIn,
      ['google', '/account'],
    ],
  ];

  it('covers every method', () => {
    expect(cases.map(([name]) => name).sort()).toEqual(Object.keys(browserAuth).sort());
  });

  it.each(cases)('%s calls its use case with the browser Supabase gateway', async (_name, call, useCase, args) => {
    const result = { ok: true, marker: Symbol('result') };
    vi.mocked(useCase).mockReturnValue(Promise.resolve(result));

    expect(await call()).toBe(result);
    expect(useCase).toHaveBeenCalledWith(deps, ...args);
    expect(createSupabaseAuthGateway).toHaveBeenCalledWith(browserClient);
  });

  it.each(cases)('%s passes a failure from its use case through unchanged', async (_name, call, useCase) => {
    const failure = { ok: false, code: 'rate_limited' };
    vi.mocked(useCase).mockReturnValue(Promise.resolve(failure));

    expect(await call()).toBe(failure);
  });

  it('starts Google sign-in without a next path when none is given', async () => {
    await browserAuth.startGoogleSignIn();
    expect(useCases.startOAuthSignIn).toHaveBeenLastCalledWith(deps, 'google', undefined);
  });

  it('builds return URLs from the configured site, not from wherever the page was loaded', async () => {
    await browserAuth.signUp(form);
    expect(vi.mocked(useCases.signUp).mock.lastCall?.[0].siteUrl).toBe('http://localhost:3000');
  });

  it('wires the gateway per call, so it always uses the current browser client', async () => {
    await browserAuth.signIn(form);
    await browserAuth.signIn(form);
    expect(createBrowserSupabase).toHaveBeenCalledTimes(2);
    expect(createSupabaseAuthGateway).toHaveBeenCalledTimes(2);
  });
});
