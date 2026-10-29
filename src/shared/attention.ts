// Steps only the account owner can complete: logging in (2FA included), X's
// own checks (captcha, email/phone codes, account unlock) and switching back to
// the right account. Xomoni waits for the person; it never fills these in.
import type { PageInfo } from './messages';

export type Need = 'login' | 'verify' | 'account';

export const isLoginPath = (path: string) => path === '/login' || path.startsWith('/i/flow/login');

/** X's check pages: /account/access (unlock), /account/login_challenge, and /i/flow steps other than login. */
export const isCheckPath = (path: string) => path.startsWith('/account/') || (path.startsWith('/i/flow/') && !isLoginPath(path));

export function pageNeed(info: Pick<PageInfo, 'loggedIn' | 'locked' | 'challenge' | 'viewerId'>, accountId: string): Need | null {
  if (!info.loggedIn) return 'login';
  if (info.locked || info.challenge) return 'verify';
  if (info.viewerId !== accountId) return 'account';
  return null;
}

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

export const NEED_TITLE: Record<Need, string> = {
  login: 'Log in to X',
  verify: 'Confirm it’s you on X',
  account: 'Switch X account',
};
