import type { ConsoleSignInResult } from '../domain/sign-in';
import type { ConsoleSignInGateway } from './ports';

/** Untrusted form input: whatever the browser sent. */
export interface ConsoleSignInInput {
  readonly email: unknown;
  readonly password: unknown;
  readonly captchaToken: unknown;
}

/**
 * The console's sign-in (#516): signs in with email and password, then asks the database whether the account is a
 * super-admin. If it isn't, it signs out again at once and answers `refused`, exactly as for a wrong password, so the
 * form never tells whether an account exists or what it may open. A super-admin whose account has an authenticator app
 * is told to give a code next; when that can't be read, the code page decides (it sends on anyone who owes none).
 */
export async function signInToConsole(
  gateway: ConsoleSignInGateway,
  input: ConsoleSignInInput,
): Promise<ConsoleSignInResult> {
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!email || !password) return { ok: false, problem: 'missing' };
  const captchaToken = typeof input.captchaToken === 'string' ? input.captchaToken : undefined;

  const signedIn = await gateway.signInWithPassword({ email, password, captchaToken });
  if (signedIn !== 'ok') return { ok: false, problem: signedIn };

  let superadmin: boolean;
  try {
    superadmin = await gateway.isSuperadmin();
  } catch {
    await gateway.signOut();
    return { ok: false, problem: 'failed' };
  }
  if (!superadmin) {
    await gateway.signOut();
    return { ok: false, problem: 'refused' };
  }

  const secondFactor = await gateway.secondFactorNeeded().catch(() => true);
  return { ok: true, secondFactor };
}
