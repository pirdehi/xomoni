// Xomoni's extension ids (#302). Chrome lets a web page message an extension only by its id. A zip install gets an id
// Chrome derives from its folder, so it names itself in the pages it opens (`#ext=`, ADR-0025). A store install, or a
// zip whose manifest carries the store item's public key (`key`), has a fixed id the site can know beforehand. This
// file is the one place those fixed ids are written: xomoni.com asks them for Xomoni, and the extension's manifest test
// checks the Chrome id against the manifest's `key`. Pure, and the same in a browser and in Node (Web Crypto).

/** Chrome's id of an extension: 32 letters from a to p. */
export const EXTENSION_ID = /^[a-p]{32}$/;

/** Whether `value` is shaped like an extension id. */
export function isExtensionId(value: unknown): value is string {
  return typeof value === 'string' && EXTENSION_ID.test(value);
}

/** A store that gives Xomoni a fixed id. */
export type Store = 'chrome' | 'edge';

/**
 * Xomoni's fixed id in each store, or null until it is there. Adding one is all it takes: xomoni.com then finds Xomoni
 * at that id without `#ext=` (#302, ADR-0025), and every page that talks to Xomoni works as soon as it is installed.
 * - `chrome`: the Chrome Web Store item's id, on the item's page in the developer dashboard and in its store link.
 *   `apps/extension/public/manifest.json`'s `key` is the same item's public key (Package › View public key), so a zip
 *   install has this id too. The two are set in one pull request: the extension's `manifest-key.test.ts` fails when
 *   only one is set, or when the key gives another id (`manifestKeyProblems`). See docs/RELEASING.md.
 * - `edge`: the Edge Add-ons item's id, from Partner Center. Microsoft assigns it; it isn't derived from the key, so a
 *   copy from the Edge store has an id of its own.
 *
 * Neither is a secret, and neither proves an answer is Xomoni's: anyone can load an unpacked extension with a public
 * key and get its id. It only says where to ask, like `#ext=` does.
 */
export const STORE_EXTENSION_IDS: Readonly<Record<Store, string | null>> = {
  chrome: null,
  edge: null,
};

/**
 * The stores' ids that are set, in the order xomoni.com prefers them: Chrome's, then Edge's. A value that isn't shaped
 * like an extension id is left out, and so is a repeat.
 */
export function storeExtensionIds(ids: Readonly<Record<Store, string | null>> = STORE_EXTENSION_IDS): string[] {
  return [...new Set([ids.chrome, ids.edge].filter(isExtensionId))];
}

/** What a manifest's `key` gives: the extension id Chrome derives from it, or what is wrong with it. */
export type ManifestKey = { ok: true; id: string; bits: number } | { ok: false; problem: string };

/** The fewest bits of an RSA key the Chrome Web Store gives (it gives 2048). */
const MIN_KEY_BITS = 2048;

/** Standard base64 on one line, padded: how the dashboard's key reads once its newlines are removed. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Reads a manifest's `key` as Chrome does: base64 of the DER of an RSA public key (SubjectPublicKeyInfo), at least
 * 2048 bits. The id is the first 128 bits of the SHA-256 of those bytes, each hex digit 0–f written as a letter a–p.
 */
export async function readManifestKey(key: unknown): Promise<ManifestKey> {
  if (typeof key !== 'string' || key === '' || !BASE64.test(key))
    return {
      ok: false,
      problem: 'the key is not base64 on one line (remove the BEGIN and END lines and the newlines)',
    };
  const der = Uint8Array.from(atob(key), (char) => char.charCodeAt(0));
  let bits: number;
  try {
    const imported = await crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, [
      'verify',
    ]);
    bits = (imported.algorithm as RsaHashedKeyAlgorithm).modulusLength;
  } catch {
    return { ok: false, problem: 'the key is not an RSA public key (SubjectPublicKeyInfo)' };
  }
  if (bits < MIN_KEY_BITS) return { ok: false, problem: `the key has ${bits} bits, fewer than ${MIN_KEY_BITS}` };
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', der));
  let id = '';
  for (const byte of hash.subarray(0, 16)) id += String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15));
  return { ok: true, id, bits };
}

/**
 * What is wrong with a manifest's `key` (undefined when there is none) and the Chrome id written beside it (#302).
 * They come together: no key and no id, or a key that gives exactly that id. Empty when all is in order.
 */
export async function manifestKeyProblems(key: unknown, chromeId: string | null): Promise<string[]> {
  if (key === undefined)
    return chromeId === null
      ? []
      : [`STORE_EXTENSION_IDS.chrome is ${chromeId}, but manifest.json has no key: add the item's public key too`];
  const read = await readManifestKey(key);
  if (!read.ok) return [`manifest.json's key: ${read.problem}`];
  if (chromeId === null)
    return [`manifest.json's key gives the id ${read.id}, but STORE_EXTENSION_IDS.chrome is null: set it to that id`];
  return read.id === chromeId
    ? []
    : [`manifest.json's key gives the id ${read.id}, but STORE_EXTENSION_IDS.chrome is ${chromeId}`];
}
