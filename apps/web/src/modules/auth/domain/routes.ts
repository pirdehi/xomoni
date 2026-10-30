/** Paths the auth module owns or guards. */
export const ROUTES = {
  home: '/',
  signIn: '/login',
  signUp: '/signup',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  account: '/account',
  dashboard: '/dashboard',
  oauthCallback: '/auth/callback',
  emailConfirm: '/auth/confirm',
  signOut: '/auth/signout',
} as const;

/** Paths that need a signed-in session; the proxy sends signed-out visitors to sign in. */
const PROTECTED_PREFIXES: readonly string[] = [ROUTES.dashboard, ROUTES.account, ROUTES.resetPassword];

/** Paths only for signed-out visitors; the proxy sends signed-in visitors to the dashboard. */
const GUEST_ONLY_PATHS: readonly string[] = [ROUTES.signIn, ROUTES.signUp, ROUTES.forgotPassword];

/** Whether `path` needs a session. */
export function requiresSession(path: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Whether `path` is only for signed-out visitors. */
export function isGuestOnly(path: string): boolean {
  return GUEST_ONLY_PATHS.includes(path);
}

/**
 * Turns an untrusted `next` value into a same-site path, or `fallback`.
 * Rejects absolute URLs, protocol-relative `//host` and backslash tricks, so links in emails
 * and OAuth round-trips can't be turned into open redirects.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string = ROUTES.dashboard): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  try {
    const url = new URL(raw, 'https://xomoni.invalid');
    if (url.origin !== 'https://xomoni.invalid') return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
