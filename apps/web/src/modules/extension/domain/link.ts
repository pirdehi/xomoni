// How xomoni.com finds the Xomoni extension in this browser (#232, ADR-0025). Chrome only lets a page message an
// extension by its id, and an install from a release zip gets its own id. So the extension puts its id in the fragment
// of every xomoni.com page it opens (`#ext=<id>`), which never reaches a server, and the site keeps it. A store install,
// or a zip carrying the store's key, has a fixed id the site knows beforehand (#302), so it is found without one. Pure.
import { isExtensionId, storeExtensionIds } from '@xomoni/bridge';

/** The extension id in a page's fragment (`#ext=…`, with or without other parameters), or null. */
export function extensionIdIn(hash: string): string | null {
  const id = new URLSearchParams(hash.replace(/^#/, '')).get('ext');
  return isExtensionId(id) ? id : null;
}

/**
 * The fragment without the extension's parameters (`ext`, and a connect request's `nonce`), so they leave the address
 * bar and the history; other parameters stay. Empty when nothing else was there.
 */
export function withoutExtensionId(hash: string): string {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  params.delete('ext');
  params.delete('nonce');
  const rest = params.toString();
  return rest ? `#${rest}` : '';
}

/**
 * The fixed ids the site asks for Xomoni without being told (#302), best first: the stores' (`STORE_EXTENSION_IDS` in
 * `@xomoni/bridge`, Chrome's, then Edge's), then the end-to-end tests' extension when one is given. Empty until a
 * store's id is written there.
 */
export function fixedExtensionIds(testId: string | null, stores: readonly string[] = storeExtensionIds()): string[] {
  return [...new Set([...stores, testId].filter(isExtensionId))];
}

/**
 * The ids to ask for Xomoni, best first, each once (#302): the one a page of Xomoni named (`#ext=`, which the site
 * keeps) comes first, so a zip install from before the fixed id keeps working and wins over a store's copy in the same
 * browser; then the fixed ids. Malformed ids are left out.
 */
export function extensionCandidates(remembered: string | null, fixedIds: readonly string[]): string[] {
  return [...new Set([remembered, ...fixedIds].filter(isExtensionId))];
}
