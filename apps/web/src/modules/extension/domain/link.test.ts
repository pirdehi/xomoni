import { describe, expect, it } from 'vitest';
import { STORE_EXTENSION_IDS } from '@xomoni/bridge';
import { extensionCandidates, extensionIdIn, fixedExtensionIds, withoutExtensionId } from './link';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const CHROME = 'ponmlkjihgfedcbaponmlkjihgfedcba';
const EDGE = 'aaaabbbbccccddddeeeeffffgggghhhh';
const TEST = 'lfkkdbhljalnifmdncjhifjonfpajeng';

describe('extensionIdIn (#232)', () => {
  it('reads the id the extension put in the fragment, alone or with a connect request', () => {
    expect(extensionIdIn(`#ext=${EXT}`)).toBe(EXT);
    expect(extensionIdIn(`#ext=${EXT}&nonce=AbCdEfGhIjKlMnOpQrStUv`)).toBe(EXT);
    expect(extensionIdIn(`ext=${EXT}`)).toBe(EXT);
  });

  it('ignores a missing or malformed id', () => {
    expect(extensionIdIn('')).toBeNull();
    expect(extensionIdIn('#section-2')).toBeNull();
    expect(extensionIdIn('#ext=not-an-extension')).toBeNull();
    expect(extensionIdIn(`#ext=${EXT.toUpperCase()}`)).toBeNull();
  });
});

describe('withoutExtensionId (#232)', () => {
  it('drops the extension’s parameters and keeps the rest', () => {
    expect(withoutExtensionId(`#ext=${EXT}`)).toBe('');
    expect(withoutExtensionId(`#ext=${EXT}&nonce=AbCdEfGhIjKlMnOpQrStUv`)).toBe('');
    expect(withoutExtensionId(`#ext=${EXT}&tab=jobs`)).toBe('#tab=jobs');
    expect(withoutExtensionId('')).toBe('');
  });
});

describe('fixedExtensionIds (#302)', () => {
  it('asks the stores’ ids, Chrome’s first, then the end-to-end tests’ extension', () => {
    expect(fixedExtensionIds(null, [CHROME, EDGE])).toEqual([CHROME, EDGE]);
    expect(fixedExtensionIds(TEST, [CHROME, EDGE])).toEqual([CHROME, EDGE, TEST]);
    expect(fixedExtensionIds(TEST, [])).toEqual([TEST]);
  });

  it('leaves out a malformed or repeated id', () => {
    expect(fixedExtensionIds('not-an-id', [CHROME])).toEqual([CHROME]);
    expect(fixedExtensionIds(CHROME, [CHROME, 'x'])).toEqual([CHROME]);
  });

  it('knows no store id until one is written in @xomoni/bridge', () => {
    const written = [STORE_EXTENSION_IDS.chrome, STORE_EXTENSION_IDS.edge].filter((id) => id !== null);
    expect(fixedExtensionIds(null)).toEqual(written);
  });
});

describe('extensionCandidates (#302)', () => {
  it('asks the id a page of Xomoni named first, then the fixed ids, each once', () => {
    expect(extensionCandidates(EXT, [CHROME, EDGE])).toEqual([EXT, CHROME, EDGE]);
    expect(extensionCandidates(CHROME, [CHROME, EDGE])).toEqual([CHROME, EDGE]);
    expect(extensionCandidates(EDGE, [CHROME, EDGE])).toEqual([EDGE, CHROME]);
  });

  it('asks only what it knows: nothing without either, and never a malformed id', () => {
    expect(extensionCandidates(null, [])).toEqual([]);
    expect(extensionCandidates(null, [CHROME])).toEqual([CHROME]);
    expect(extensionCandidates(EXT, [])).toEqual([EXT]);
    expect(extensionCandidates('not-an-id', ['NOPE', CHROME])).toEqual([CHROME]);
  });
});
