// How xomoni.com finds the Xomoni extension in this browser (#232, ADR-0025). Chrome only lets a page message an
// extension by its id, and an install from a release zip gets its own id. So the extension puts its id in the fragment
// of every xomoni.com page it opens (`#ext=<id>`), which never reaches a server, and the site keeps it. Pure.
import { isExtensionId } from '@xomoni/bridge';

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
