'use client';
// One sign-in for xomoni.com and the Xomoni extension in this browser (#232, ADR-0025), on every page of the site.
// Renders nothing. It keeps the extension's id from a page the extension opened, brings the two into step when a page
// opens, comes back into view or the browser signs in or out, and signs the extension out with the website.
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import {
  type ExtensionLinkState,
  type ExtensionSessionServices,
  createExtensionSessionServices,
  currentLink,
  onLinkCheckRequest,
  rememberExtensionId,
  subscribeLink,
} from '../client/extension-session';
import { extensionIdIn, withoutExtensionId } from '../domain/link';

export { rememberExtensionId };
export type { ExtensionLinkState };

/** The page that finishes a connection the extension asked for (ADR-0024); it pairs by itself, so no sync runs there. */
const CONNECT_PATH = '/connect';
/** The site's sign-out route: forms posting there sign the extension out first. */
const SIGN_OUT_PATH = '/auth/signout';
/** Where the site goes once a sign-out made in the extension signed it out too. */
const SIGNED_OUT_LANDING = '/login';

/** The link before the first sync, and on the server: one object, as `useSyncExternalStore` needs. */
export const UNKNOWN_LINK: ExtensionLinkState = { status: 'unknown' };

const serverLink = () => UNKNOWN_LINK;

/** How the extension in this browser stands with the site, as of the last sync; `unknown` before the first. */
export function useExtensionLink(): ExtensionLinkState {
  return useSyncExternalStore(subscribeLink, currentLink, serverLink);
}

/**
 * Keeps the site and the extension signed in and out together:
 * - an `#ext=<id>` fragment is kept and cleared from the address bar;
 * - a sync runs when the page opens, when it comes back into view, when the browser signs in or out and when a page
 *   asks to look again (`requestLinkCheck`, the live checklist); a sync that signed the website out goes to the
 *   sign-in page;
 * - a form posting to the sign-out route (the header's *Sign out*, the account page's) first signs the extension out,
 *   then posts as before.
 */
export function ExtensionSessionSync({ services }: { services?: () => ExtensionSessionServices }) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const live = (services ?? createExtensionSessionServices)();
    const id = extensionIdIn(window.location.hash);
    if (id) {
      live.rememberExtension(id);
      if (pathname !== CONNECT_PATH) {
        const { pathname: path, search, hash } = window.location;
        window.history.replaceState(window.history.state, '', `${path}${search}${withoutExtensionId(hash)}`);
      }
    }

    let alive = true;
    let running = false;
    const sync = () => {
      if (running || pathname === CONNECT_PATH) return;
      running = true;
      live
        .sync()
        .then((outcome) => {
          if (!alive || outcome.kind !== 'website-signed-out') return;
          router.replace(SIGNED_OUT_LANDING);
          router.refresh();
        })
        .catch((err: unknown) => console.warn('[xomoni] sync with the extension failed', err))
        .finally(() => (running = false));
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (new URL(form.action, window.location.href).pathname !== SIGN_OUT_PATH) return;
      event.preventDefault();
      void live
        .signOutBoth()
        .catch((err: unknown) => console.warn('[xomoni] could not sign the extension out', err))
        .finally(() => form.submit());
    };

    sync();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', sync);
    document.addEventListener('submit', onSubmit, true);
    const stopWatching = live.onSessionChange(sync);
    const stopChecks = onLinkCheckRequest(sync);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', sync);
      document.removeEventListener('submit', onSubmit, true);
      stopWatching();
      stopChecks();
    };
  }, [pathname, router, services]);
  return null;
}
