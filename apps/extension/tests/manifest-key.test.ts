import { STORE_EXTENSION_IDS, manifestKeyProblems } from '@xomoni/bridge';
import { describe, expect, it } from 'vitest';
import manifestJson from '../public/manifest.json';

const manifest: Record<string, unknown> = manifestJson;

describe('the fixed id: the manifest’s key and the Chrome Web Store id come together (#302)', () => {
  it('has a key exactly when STORE_EXTENSION_IDS.chrome is set, and the key gives that id', async () => {
    // No key: a zip install keeps the id Chrome gives its folder, and xomoni.com knows no Chrome id to ask.
    // A key (Package › View public key, docs/RELEASING.md): the store item's public key, as base64 of an RSA
    // SubjectPublicKeyInfo, so a zip install and the store's copy share that one id.
    expect(await manifestKeyProblems(manifest.key, STORE_EXTENSION_IDS.chrome)).toEqual([]);
  });

  it('never carries a key in PEM form or a private key', () => {
    // A private key (base64 PKCS #8) isn't a SubjectPublicKeyInfo, so the check above refuses it too.
    expect(JSON.stringify(manifest)).not.toMatch(/-----BEGIN|PRIVATE/);
  });
});
