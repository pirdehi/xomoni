import { describe, expect, it } from 'vitest';
import { extensionIdIn, withoutExtensionId } from './link';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';

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
