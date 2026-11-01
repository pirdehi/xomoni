// Steps only the account owner can complete: logging in (2FA included), X's
// own checks (captcha, email/phone codes, account unlock) and switching back to
// the right account. Xomoni waits for the person; it never fills these in.
import type { PageInfo } from './messages';

/**
 * What only the person can do: `login` (signed out), `verify` (an X check or account lock), `account` (the
 * worker is signed in to a different X account), `obstruction` (a pop-up Xomoni couldn't close covers the page).
 */
export type Need = 'login' | 'verify' | 'account' | 'obstruction';

/**
 * Whether a path is one of X's login pages: `/login`, the `/i/flow/login` flow, or any page of the newer
 * `/i/jf/` onboarding flow (PLAYBOOK D2), which X uses for login and verification.
 */
export const isLoginPath = (path: string) =>
  path === '/login' || path.startsWith('/i/flow/login') || path.startsWith('/i/jf/');

/** X's check pages: /account/access (unlock), /account/login_challenge, and /i/flow steps other than login. */
export const isCheckPath = (path: string) =>
  path.startsWith('/account/') || (path.startsWith('/i/flow/') && !isLoginPath(path));

/**
 * What the page needs from the person before Xomoni may act, or null when it is signed in to `accountId`
 * with no check or pop-up showing. Checked in order: login, verify, account, obstruction.
 */
export function pageNeed(
  info: Pick<PageInfo, 'loggedIn' | 'locked' | 'challenge' | 'viewerId'> & Partial<Pick<PageInfo, 'obstructed'>>,
  accountId: string,
): Need | null {
  if (!info.loggedIn) return 'login';
  if (info.locked || info.challenge) return 'verify';
  if (info.viewerId !== accountId) return 'account';
  if (info.obstructed) return 'obstruction';
  return null;
}

/** The instruction shown to the person for a need; names `@handle` when known. */
export function needMessage(need: Need, handle: string): string {
  const who = handle ? `@${handle}` : 'your account';
  switch (need) {
    case 'login':
      return `Log in to X as ${who} in the Xomoni window (including 2FA).`;
    case 'verify':
      return 'X wants to confirm it’s you (captcha, code or account unlock). Complete it in the Xomoni window.';
    case 'account':
      return `The Xomoni window is signed in to another X account. Switch back to ${who}.`;
    case 'obstruction':
      return 'Something on X’s page is in the way, and Xomoni couldn’t close it. Close it in the Xomoni window; Xomoni continues by itself.';
  }
}

/**
 * Phrases X shows when it has suspended or limited an account (PLAYBOOK C3, C4), lowercase. Matching is
 * deliberately broad: a false match only stops the job, which is the safe direction.
 */
const RESTRICTION_PHRASES = [
  'your account is suspended',
  'account has been suspended',
  'account is temporarily limited',
  'features are temporarily limited',
  'temporarily restricted',
  'your account is restricted',
  'read-only mode',
];

/**
 * The line of page text that says X suspended or limited the account, or null. Waiting for the person can't
 * fix these, so the job stops instead of retrying.
 */
export function restrictionNotice(text: string): string | null {
  for (const line of text.split(/\n+/)) {
    const lower = line.toLowerCase();
    if (RESTRICTION_PHRASES.some((p) => lower.includes(p))) return line.trim().slice(0, 200);
  }
  return null;
}

/** Short title per need, used in notification titles. */
export const NEED_TITLE: Record<Need, string> = {
  login: 'Log in to X',
  verify: 'Confirm it’s you on X',
  account: 'Switch X account',
  obstruction: 'Close what covers X’s page',
};
