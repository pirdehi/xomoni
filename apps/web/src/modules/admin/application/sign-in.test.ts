import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsoleSignInGateway } from './ports';
import { signInToConsole } from './sign-in';

function gateway(overrides: Partial<ConsoleSignInGateway> = {}) {
  return {
    signInWithPassword: vi.fn<ConsoleSignInGateway['signInWithPassword']>(() => Promise.resolve('ok')),
    isSuperadmin: vi.fn(() => Promise.resolve(true)),
    secondFactorNeeded: vi.fn(() => Promise.resolve(false)),
    signOut: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

const input = { email: ' maintainer@example.com ', password: 'first password 1', captchaToken: 'token' };

describe('signInToConsole (#516)', () => {
  let g: ReturnType<typeof gateway>;
  beforeEach(() => {
    g = gateway();
  });

  it('opens the console for a super-admin, with the security check’s token', async () => {
    expect(await signInToConsole(g, input)).toEqual({ ok: true, secondFactor: false });
    expect(g.signInWithPassword).toHaveBeenCalledWith({
      email: 'maintainer@example.com',
      password: 'first password 1',
      captchaToken: 'token',
    });
    expect(g.signOut).not.toHaveBeenCalled();
  });

  it('asks a super-admin whose account has an authenticator app for a code next', async () => {
    g = gateway({ secondFactorNeeded: vi.fn(() => Promise.resolve(true)) });
    expect(await signInToConsole(g, input)).toEqual({ ok: true, secondFactor: true });
  });

  it('lets the code page decide when the level can’t be read', async () => {
    g = gateway({ secondFactorNeeded: vi.fn(() => Promise.reject(new Error('no session'))) });
    expect(await signInToConsole(g, input)).toEqual({ ok: true, secondFactor: true });
  });

  it('signs an account that isn’t a super-admin out again at once, answering as for a wrong password', async () => {
    g = gateway({ isSuperadmin: vi.fn(() => Promise.resolve(false)) });
    const stranger = await signInToConsole(g, input);
    expect(g.signOut).toHaveBeenCalledOnce();

    const wrong = await signInToConsole(
      gateway({ signInWithPassword: vi.fn(() => Promise.resolve('refused' as const)) }),
      input,
    );
    expect(stranger).toEqual({ ok: false, problem: 'refused' });
    expect(wrong).toEqual(stranger);
  });

  it('signs out again when the database can’t say who is a super-admin', async () => {
    g = gateway({ isSuperadmin: vi.fn(() => Promise.reject(new Error('down'))) });
    expect(await signInToConsole(g, input)).toEqual({ ok: false, problem: 'failed' });
    expect(g.signOut).toHaveBeenCalledOnce();
  });

  it('passes on the security check’s and the rate limit’s answers, asking nothing more', async () => {
    for (const problem of ['captcha', 'rate-limited', 'failed'] as const) {
      g = gateway({ signInWithPassword: vi.fn(() => Promise.resolve(problem)) });
      expect(await signInToConsole(g, input)).toEqual({ ok: false, problem });
      expect(g.isSuperadmin).not.toHaveBeenCalled();
    }
  });

  it('asks for both fields before calling anything, and ignores a token that isn’t text', async () => {
    for (const odd of [
      { ...input, email: '  ' },
      { ...input, password: '' },
      { ...input, email: null },
    ]) {
      expect(await signInToConsole(g, odd)).toEqual({ ok: false, problem: 'missing' });
    }
    expect(g.signInWithPassword).not.toHaveBeenCalled();
    await signInToConsole(g, { ...input, captchaToken: null });
    expect(g.signInWithPassword).toHaveBeenCalledWith(expect.objectContaining({ captchaToken: undefined }));
  });
});
