// Checking a release's signature (#305, ADR-0033). The release workflow signs each zip with an Ed25519 key that exists
// only as a GitHub Actions secret; this build trusts the public keys in `release-keys.json`. The check is the browser's
// own Ed25519 (Web Crypto, Chrome 137 and later): no signature code of Xomoni's own. A browser without it can't update
// in one click, and says so; it never installs anything unchecked.
import releaseKeys from './release-keys.json';

/** The length of an Ed25519 signature, in bytes. */
export const SIGNATURE_BYTES = 64;

/** The length of an Ed25519 public key, in bytes. */
const KEY_BYTES = 32;

/** A valid Ed25519 public key (RFC 8032, test 1), only to learn whether this browser can import one. */
const PROBE_KEY = Uint8Array.from(atob('11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo='), (c) => c.charCodeAt(0));

/** The bytes of a base64 public key, or null when it isn't the 32 bytes of an Ed25519 key. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key)) return null;
  const bytes = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
  return bytes.length === KEY_BYTES ? bytes : null;
}

/** The keys of `value` (the JSON file's list) that are Ed25519 public keys in base64; anything else is left out. */
export function trustedKeys(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string' && !!keyBytes(key)) : [];
}

/**
 * The public keys this build trusts to sign a release: base64 of the 32 raw bytes, one per signing key. More than one
 * only while a key is being replaced (docs/RELEASING.md). Empty until the maintainer adds the first one; then no
 * one-click update is possible, and the dashboard says so.
 */
export const RELEASE_KEYS: readonly string[] = trustedKeys(releaseKeys.keys);

/** Whether this browser's Web Crypto knows Ed25519 (Chrome 137 and later). */
export async function ed25519Available(subtle: SubtleCrypto = crypto.subtle): Promise<boolean> {
  try {
    await subtle.importKey('raw', PROBE_KEY, { name: 'Ed25519' }, false, ['verify']);
    return true;
  } catch {
    return false;
  }
}

/**
 * The key, of `keys`, whose Ed25519 signature `signature` is over exactly the bytes of `data`; null when none is. A
 * signature of the wrong length, a malformed key or a browser without Ed25519 gives null too: never an exception
 * that a caller could take for a pass.
 */
export async function signedBy(
  data: Uint8Array<ArrayBuffer>,
  signature: Uint8Array<ArrayBuffer>,
  keys: readonly string[] = RELEASE_KEYS,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<string | null> {
  if (signature.length !== SIGNATURE_BYTES) return null;
  for (const key of keys) {
    const raw = keyBytes(key);
    if (!raw) continue;
    try {
      const publicKey = await subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
      if (await subtle.verify({ name: 'Ed25519' }, publicKey, signature, data)) return key;
    } catch {
      // Not this key: a key the browser refuses, or a browser without Ed25519, verifies nothing.
    }
  }
  return null;
}
