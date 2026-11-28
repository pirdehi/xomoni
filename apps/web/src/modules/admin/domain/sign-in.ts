/**
 * Why the console's sign-in didn't open the console. `refused` covers a wrong password, an unknown email and an
 * account that isn't a super-admin alike, so the form never tells which.
 */
export type ConsoleSignInProblem = 'refused' | 'missing' | 'captcha' | 'rate-limited' | 'failed';

/** The one answer for wrong details and for an account that isn't a super-admin (#516). */
export const CONSOLE_REFUSED = 'These details don’t open the console.';

/** The words for each {@link ConsoleSignInProblem}; none says whether an account exists. */
export const CONSOLE_SIGN_IN_MESSAGES: Readonly<Record<ConsoleSignInProblem, string>> = {
  refused: CONSOLE_REFUSED,
  missing: 'Enter your email and password.',
  captcha: 'We couldn’t confirm you’re human. Wait for the check to finish, then try again.',
  'rate-limited': 'Too many attempts. Wait a minute and try again.',
  failed: 'Something went wrong on our side. Try again in a moment.',
};

/** What the console's sign-in did: opened the console (first asking for a code when the account has an app), or not. */
export type ConsoleSignInResult =
  | { readonly ok: true; readonly secondFactor: boolean }
  | { readonly ok: false; readonly problem: ConsoleSignInProblem };
