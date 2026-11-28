/** Paths the auth module owns or guards. */
export const ROUTES = {
  home: '/',
  signIn: '/login',
  twoFactor: '/login/two-factor',
  signUp: '/signup',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  account: '/account',
  dashboard: '/dashboard',
  oauthCallback: '/auth/callback',
  emailConfirm: '/auth/confirm',
  signOut: '/auth/signout',
  product: '/product',
  productSignIn: '/product/login',
  productDocument: '/product/document',
} as const;

/** Paths that need a signed-in session; the proxy sends signed-out visitors to sign in. */
const PROTECTED_PREFIXES: readonly string[] = [ROUTES.dashboard, ROUTES.account, ROUTES.resetPassword, ROUTES.product];

/** Paths under a protected prefix that anyone may open: the console's own sign-in (#516). */
const OPEN_PATHS: readonly string[] = [ROUTES.productSignIn];

/** Paths only for signed-out visitors; the proxy sends signed-in visitors to the dashboard. */
const GUEST_ONLY_PATHS: readonly string[] = [ROUTES.signIn, ROUTES.signUp, ROUTES.forgotPassword];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Whether `path` needs a session. */
export function requiresSession(path: string): boolean {
  return !OPEN_PATHS.includes(path) && PROTECTED_PREFIXES.some((prefix) => under(path, prefix));
}

/**
 * Whether `path` is one of the super-admin console's pages (#516), which the proxy opens only to a super-admin: every
 * path under `/product` but its sign-in page, which anyone may open, and the product document, a route that answers
 * its own 404 (ADR-0048).
 */
export function isConsolePage(path: string): boolean {
  return under(path, ROUTES.product) && path !== ROUTES.productSignIn && path !== ROUTES.productDocument;
}

/**
 * Where the proxy sends anyone signed in who isn't a super-admin on a console page: an address no page answers, so they
 * get the site's own 404, with a real 404 status, the same as for any address that doesn't exist.
 */
export const NOT_FOUND_PATH = '/_console-not-found';

/**
 * The sign-in page for a visitor on their way to `path` (a path, maybe with a query): the super-admin console's own
 * (`/product/login`, #516) for the console's pages, the site's (`/login`) for everything else.
 */
export function signInPathFor(path: string | null | undefined): string {
  const pathname = (path ?? '').split(/[?#]/)[0] ?? '';
  return under(pathname, ROUTES.product) && pathname !== ROUTES.productSignIn ? ROUTES.productSignIn : ROUTES.signIn;
}

/** Whether `path` is only for signed-out visitors. */
export function isGuestOnly(path: string): boolean {
  return GUEST_ONLY_PATHS.includes(path);
}

/**
 * `path` with `?next=` added, for a page that sends the person on and then back (#244): kept only when `next` is a
 * same-site path other than the dashboard, where a sign-in lands anyway; anything else gives `path` alone. The page that
 * follows it checks `next` again.
 */
export function withNext(path: string, next?: string | null): string {
  const target = safeNextPath(next);
  return target === ROUTES.dashboard ? path : `${path}?next=${encodeURIComponent(target)}`;
}

/**
 * The page that asks for a code from an authenticator app (#173), returning to `next` afterwards. `next` is kept only
 * when it is a same-site path; the page checks it again before following it.
 */
export function twoFactorPath(next?: string | null): string {
  return withNext(ROUTES.twoFactor, next);
}

/**
 * Turns an untrusted `next` value into a same-site path, or `fallback`.
 * Rejects absolute URLs, protocol-relative `//host` and backslash tricks, so links in emails
 * and OAuth round-trips can't be turned into open redirects. The check runs again on the normalized
 * path: dot segments can turn `/.//evil.example` into `//evil.example`, which a browser reads as another site.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string = ROUTES.dashboard): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  try {
    const url = new URL(raw, 'https://xomoni.invalid');
    if (url.origin !== 'https://xomoni.invalid') return fallback;
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith('//') || path.includes('\\') ? fallback : path;
  } catch {
    return fallback;
  }
}
