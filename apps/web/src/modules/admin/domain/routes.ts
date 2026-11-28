/** The console's pages (#516). `/product/document` is the product document of ADR-0048, served sandboxed. */
export const CONSOLE_PATHS = {
  overview: '/product',
  users: '/product/users',
  roadmap: '/product/roadmap',
  document: '/product/document',
  documents: '/product/documents',
  audit: '/product/audit',
  signIn: '/product/login',
} as const;

/** One account's page in the console. */
export function userPath(id: string): string {
  return `${CONSOLE_PATHS.users}/${encodeURIComponent(id)}`;
}

/**
 * Where the console's sign-in goes next: `next` when it is one of the console's pages (other than the sign-in itself),
 * otherwise the overview. `next` must already be a same-site path (auth's `safeNextPath` on the server).
 */
export function consoleNext(next: string | null | undefined): string {
  if (!next) return CONSOLE_PATHS.overview;
  const path = next.split(/[?#]/)[0] ?? '';
  const inConsole = path === CONSOLE_PATHS.overview || path.startsWith(`${CONSOLE_PATHS.overview}/`);
  return inConsole && path !== CONSOLE_PATHS.signIn ? next : CONSOLE_PATHS.overview;
}
