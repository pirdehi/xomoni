import { describe, expect, it } from 'vitest';
import releaseKeys from '../src/update/release-keys.json';
import {
  RELEASE_KEYS,
  SIGNATURE_BYTES,
  ed25519Available,
  keyBytes,
  signedBy,
  trustedKeys,
} from '../src/update/signature';
import { throwawayKeys } from './support/release';

const hex = (text: string) => new Uint8Array(text.match(/../g)!.map((byte) => parseInt(byte, 16)));

// RFC 8032, section 7.1, TEST 2: a known key, message and signature, so the check agrees with the standard and not
// only with itself.
const RFC_KEY = 'PUAXw+hDiVqStwqnTRt+vJyYLM8uxJaMwM1V8Sr0Zgw=';
const RFC_MESSAGE = hex('72');
const RFC_SIGNATURE = hex(
  '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
);

describe('the keys this build trusts (#305)', () => {
  it('are only Ed25519 public keys in base64, as the maintainer adds them (docs/RELEASING.md)', () => {
    expect(RELEASE_KEYS).toEqual(trustedKeys(releaseKeys.keys));
    expect(RELEASE_KEYS.length).toBe(releaseKeys.keys.length);
    for (const key of RELEASE_KEYS) expect(keyBytes(key)?.length).toBe(32);
  });

  it('reads a key’s 32 bytes, and nothing else as a key', () => {
    expect(keyBytes(RFC_KEY)).toEqual(hex('3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c'));
    for (const bad of ['', 'abc', `${RFC_KEY}=`, RFC_KEY.replace('=', ''), 'A'.repeat(44), `-${RFC_KEY.slice(1)}`]) {
      expect(keyBytes(bad)).toBeNull();
    }
  });

  it('leaves out anything in the file that isn’t a key, and a file that isn’t a list', () => {
    expect(trustedKeys([RFC_KEY, 'not a key', 42, null, RFC_KEY.slice(1)])).toEqual([RFC_KEY]);
    expect(trustedKeys('PUAXw+hDiVqStwqnTRt+vJyYLM8uxJaMwM1V8Sr0Zgw=')).toEqual([]);
    expect(trustedKeys(undefined)).toEqual([]);
  });
});

describe('checking a release’s signature (#305)', () => {
  it('knows whether the browser has Ed25519: Node does, a browser before Chrome 137 doesn’t', async () => {
    expect(await ed25519Available()).toBe(true);
    const old = { importKey: () => Promise.reject(new DOMException('Unrecognized name', 'NotSupportedError')) };
    expect(await ed25519Available(old as unknown as SubtleCrypto)).toBe(false);
  });

  it('agrees with RFC 8032’s test vector', async () => {
    expect(await signedBy(RFC_MESSAGE, RFC_SIGNATURE, [RFC_KEY])).toBe(RFC_KEY);
  });

  it('accepts a zip signed by a trusted key, and says which key', async () => {
    const keys = await throwawayKeys();
    const other = await throwawayKeys();
    const zip = new TextEncoder().encode('PK… a release');
    const signature = await keys.sign(zip);
    expect(signature.length).toBe(SIGNATURE_BYTES);
    expect(await signedBy(zip, signature, [keys.publicKey])).toBe(keys.publicKey);
    // While a key is replaced, both are trusted, and either one's signature passes.
    expect(await signedBy(zip, signature, [other.publicKey, keys.publicKey])).toBe(keys.publicKey);
  });

  it('refuses a tampered zip: one byte changed, one added or one cut', async () => {
    const keys = await throwawayKeys();
    const zip = new TextEncoder().encode('PK… a release');
    const signature = await keys.sign(zip);
    const changed = zip.slice();
    changed[3] = (changed[3]! + 1) & 0xff;
    expect(await signedBy(changed, signature, [keys.publicKey])).toBeNull();
    expect(await signedBy(new Uint8Array([...zip, 0]), signature, [keys.publicKey])).toBeNull();
    expect(await signedBy(zip.slice(0, -1), signature, [keys.publicKey])).toBeNull();
  });

  it('refuses a signature by a key this build doesn’t trust', async () => {
    const keys = await throwawayKeys();
    const stranger = await throwawayKeys();
    const zip = new TextEncoder().encode('PK… a release');
    expect(await signedBy(zip, await stranger.sign(zip), [keys.publicKey])).toBeNull();
  });

  it('refuses a missing, short, long or altered signature, and trusts nothing with no key', async () => {
    const keys = await throwawayKeys();
    const zip = new TextEncoder().encode('PK… a release');
    const signature = await keys.sign(zip);
    expect(await signedBy(zip, new Uint8Array(0), [keys.publicKey])).toBeNull();
    expect(await signedBy(zip, signature.slice(0, 63), [keys.publicKey])).toBeNull();
    expect(await signedBy(zip, new Uint8Array([...signature, 0]), [keys.publicKey])).toBeNull();
    const altered = signature.slice();
    altered[10] = (altered[10]! ^ 1) & 0xff;
    expect(await signedBy(zip, altered, [keys.publicKey])).toBeNull();
    expect(await signedBy(zip, signature, [])).toBeNull();
    expect(await signedBy(zip, signature, ['not a key'])).toBeNull();
  });

  it('never takes a browser error for a pass', async () => {
    const keys = await throwawayKeys();
    const zip = new TextEncoder().encode('PK… a release');
    const broken = {
      importKey: () => Promise.resolve({}),
      verify: () => Promise.reject(new DOMException('Operation failed', 'OperationError')),
    };
    expect(await signedBy(zip, await keys.sign(zip), [keys.publicKey], broken as unknown as SubtleCrypto)).toBeNull();
  });
});
