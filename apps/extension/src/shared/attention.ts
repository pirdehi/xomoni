// Steps only the account owner can complete: logging in (2FA included), X's
// own checks (captcha, email/phone codes, account unlock) and switching back to
// the right account. Xomoni waits for the person; it never fills these in.
import type { PageInfo } from './messages';

/**
 * What only the person can do: `login` (signed out), `verify` (an X check or account lock), `account` (the
 * worker is signed in to a different X account).
 */
export type Need = 'login' | 'verify' | 'account';

/** Whether a path is X's login page. The newer `/i/jf/` login flow is not recognized yet (PLAYBOOK D2). */
export const isLoginPath = (path: string) => path === '/login' || path.startsWith('/i/flow/login');

/** X's check pages: /account/access (unlock), /account/login_challenge, and /i/flow steps other than login. */
export const isCheckPath = (path: string) => path.startsWith('/account/') || (path.startsWith('/i/flow/') && !isLoginPath(path));

/**
 * What the page needs from the person before Xomoni may act, or null when it is signed in to `accountId`
 * with no check showing. Checked in order: login, verify, account.
 */
export function pageNeed(info: Pick<PageInfo, 'loggedIn' | 'locked' | 'challenge' | 'viewerId'>, accountId: string): Need | null {
  if (!info.loggedIn) return 'login';
  if (info.locked || info.challenge) return 'verify';
  if (info.viewerId !== accountId) return 'account';
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
  }
}

/** Short title per need, used in notification titles. */
export const NEED_TITLE: Record<Need, string> = {
  login: 'Log in to X',
  verify: 'Confirm it’s you on X',
  account: 'Switch X account',
};
