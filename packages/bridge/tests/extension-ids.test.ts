import { describe, expect, it } from 'vitest';
import {
  EXTENSION_ID,
  STORE_EXTENSION_IDS,
  isExtensionId,
  manifestKeyProblems,
  readManifestKey,
  storeExtensionIds,
} from '../src/extension-ids';

/**
 * A 2048-bit RSA public key made for the tests (its private key was thrown away), and the id Chrome gave an unpacked
 * extension carrying it as `key`: the end-to-end test extension (`apps/web/e2e/fixtures/fixed-id-extension`) has it,
 * and `openssl rsa -pubout -outform DER | openssl dgst -sha256` gives the same.
 */
const KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA8BHm90lGleeCFWVRrg+fq8YUUcFv586CnFxHoycfjYfXwRNF7QWcKlSSbbs4PrGCqoa12DJNPrrpRLjJOswx/uFgvy7Br0o4ciP/CvWH+qkStql9V2mcWi/SoFhZ7rM5cAm+7T9RA4APkcpGkOC0FaO+ykYqrAgg4n1FhDxS6i6FgQMHAM0d/7y55h3Ki6b7xo7+M0DVq/yKKqP3jmjhruHeuL4xCPCsaSZM/neuOWN5+75agvcHRaK229AyOCu15+SluzesOBezB+WqurVMoL9v4qpkHw1fI2zYCpUFpZrwS5WoWyKWzW9Kl17+Q1nbAdlfx6hnA1SbrxSAaDUF4QIDAQAB';
const KEY_ID = 'lfkkdbhljalnifmdncjhifjonfpajeng';
/** A 1024-bit RSA public key: too short for the store. */
const SHORT_KEY =
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDJL5tsyvoSQiHvN0/v2jAfnpTl42ohuQ/3xzW4MGLSMo7LSll1FOuUQh9Sj5LsiafFw3xnXdq4EcrE1N8vviu8cy/7v6jxXGqRnzWGAb2O60sRUvZ7+eLwsnYndUV8c2ppfDGgjDgbb32YcLIAZfLtHIsHLsOJgmx9OOqBWlqeQQIDAQAB';
/** An elliptic-curve (P-256) public key: not what the store gives. */
const EC_KEY =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEeh8tJob/r33eBVgku9cp7OVzwaOdujX+ly1Ny6aNaZgtRc7UnULe8cYls55nUb/gS3kVHO7zqE5UFG9PkiUdiA==';
const OTHER_ID = 'abcdefghijklmnopabcdefghijklmnop';

describe('extension ids (#302)', () => {
  it('knows an id by its shape: 32 letters from a to p', () => {
    expect(isExtensionId(KEY_ID)).toBe(true);
    expect(EXTENSION_ID.test(OTHER_ID)).toBe(true);
    for (const bad of ['abcdefghijklmnopabcdefghijklmnoq', 'abcdefghijklmnop', '', 42, null, undefined])
      expect(isExtensionId(bad), JSON.stringify(bad)).toBe(false);
  });

  it('writes the stores’ ids, when set, as ids, each its own', () => {
    expect(Object.keys(STORE_EXTENSION_IDS).sort()).toEqual(['chrome', 'edge']);
    const set = Object.values(STORE_EXTENSION_IDS).filter((id) => id !== null);
    expect(set.filter((id) => !isExtensionId(id))).toEqual([]);
    expect(storeExtensionIds()).toEqual(set);
  });

  it('lists the stores’ ids Chrome first, then Edge, leaving out unset, malformed and repeated ones', () => {
    expect(storeExtensionIds({ chrome: null, edge: null })).toEqual([]);
    expect(storeExtensionIds({ chrome: KEY_ID, edge: OTHER_ID })).toEqual([KEY_ID, OTHER_ID]);
    expect(storeExtensionIds({ chrome: null, edge: OTHER_ID })).toEqual([OTHER_ID]);
    expect(storeExtensionIds({ chrome: 'not an id', edge: OTHER_ID })).toEqual([OTHER_ID]);
    expect(storeExtensionIds({ chrome: KEY_ID, edge: KEY_ID })).toEqual([KEY_ID]);
  });
});

describe('a manifest key (#302)', () => {
  it('gives the id Chrome derives: the SHA-256 of the key’s bytes, first 128 bits, 0–f as a–p', async () => {
    expect(await readManifestKey(KEY)).toEqual({ ok: true, id: KEY_ID, bits: 2048 });
  });

  it('must be base64 on one line, as the dashboard’s key reads without its BEGIN, END and newlines', async () => {
    for (const bad of [undefined, null, 42, '', `${KEY.slice(0, 64)}\n${KEY.slice(64)}`, `-----BEGIN PUBLIC KEY-----`])
      expect(await readManifestKey(bad), JSON.stringify(bad)).toEqual({
        ok: false,
        problem: 'the key is not base64 on one line (remove the BEGIN and END lines and the newlines)',
      });
    expect(await readManifestKey(KEY.slice(1))).toMatchObject({ ok: false });
  });

  it('must be an RSA public key of 2048 bits or more', async () => {
    const notRsa = { ok: false, problem: 'the key is not an RSA public key (SubjectPublicKeyInfo)' };
    expect(await readManifestKey('AAAA')).toEqual(notRsa);
    expect(await readManifestKey(EC_KEY)).toEqual(notRsa);
    expect(await readManifestKey(SHORT_KEY)).toEqual({ ok: false, problem: 'the key has 1024 bits, fewer than 2048' });
  });

  it('comes with the Chrome id: neither, or a key that gives exactly that id', async () => {
    expect(await manifestKeyProblems(undefined, null)).toEqual([]);
    expect(await manifestKeyProblems(KEY, KEY_ID)).toEqual([]);
  });

  it('says what is missing or wrong when they don’t agree', async () => {
    expect(await manifestKeyProblems(undefined, KEY_ID)).toEqual([
      `STORE_EXTENSION_IDS.chrome is ${KEY_ID}, but manifest.json has no key: add the item's public key too`,
    ]);
    expect(await manifestKeyProblems(KEY, null)).toEqual([
      `manifest.json's key gives the id ${KEY_ID}, but STORE_EXTENSION_IDS.chrome is null: set it to that id`,
    ]);
    expect(await manifestKeyProblems(KEY, OTHER_ID)).toEqual([
      `manifest.json's key gives the id ${KEY_ID}, but STORE_EXTENSION_IDS.chrome is ${OTHER_ID}`,
    ]);
    expect(await manifestKeyProblems(EC_KEY, KEY_ID)).toEqual([
      "manifest.json's key: the key is not an RSA public key (SubjectPublicKeyInfo)",
    ]);
  });
});
