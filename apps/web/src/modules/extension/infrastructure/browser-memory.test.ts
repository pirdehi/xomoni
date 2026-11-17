// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { type KeyValueStorage, MEMORY_KEYS, createBrowserMemory } from './browser-memory';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';

/** An in-memory `Storage`. */
function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const store: KeyValueStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
  return { store, map };
}

describe('browser memory (#232)', () => {
  it('keeps the extension id, and only a well-formed one', () => {
    const { store, map } = storage();
    const memory = createBrowserMemory(() => store);

    expect(memory.extensionId()).toBeNull();
    memory.rememberExtension('not-an-id');
    expect(memory.extensionId()).toBeNull();
    memory.rememberExtension(EXT);
    expect(memory.extensionId()).toBe(EXT);
    expect(map.get(MEMORY_KEYS.extension)).toBe(EXT);
  });

  it('ignores a malformed id someone stored', () => {
    const { store } = storage({ [MEMORY_KEYS.extension]: 'zzzz' });
    expect(createBrowserMemory(() => store).extensionId()).toBeNull();
  });

  it('keeps when the person signed out, reading anything else as never', () => {
    const { store } = storage();
    const memory = createBrowserMemory(() => store);

    expect(memory.websiteSignedOutAt()).toBe(0);
    memory.rememberSignOut(1234);
    expect(memory.websiteSignedOutAt()).toBe(1234);
    store.setItem(MEMORY_KEYS.signedOutAt, 'yesterday');
    expect(memory.websiteSignedOutAt()).toBe(0);
    store.setItem(MEMORY_KEYS.signedOutAt, '-5');
    expect(memory.websiteSignedOutAt()).toBe(0);
  });

  it('remembers when it first saw a session, and starts over for a new one', () => {
    const { store } = storage();
    const memory = createBrowserMemory(() => store);

    expect(memory.sessionSeenAt('s1', 100)).toBe(100);
    expect(memory.sessionSeenAt('s1', 200)).toBe(100);
    expect(memory.sessionSeenAt('s2', 300)).toBe(300);
    expect(memory.sessionSeenAt('s1', 400)).toBe(400);
  });

  it('counts a session as new when what was stored can’t be read', () => {
    const { store } = storage({ [MEMORY_KEYS.session]: '{not json' });
    expect(createBrowserMemory(() => store).sessionSeenAt('s1', 500)).toBe(500);

    store.setItem(MEMORY_KEYS.session, JSON.stringify({ id: 's1', at: 'noon' }));
    expect(createBrowserMemory(() => store).sessionSeenAt('s1', 600)).toBe(600);
  });

  it('works without storage, or with storage that throws', () => {
    const none = createBrowserMemory(() => null);
    expect(none.extensionId()).toBeNull();
    none.rememberExtension(EXT);
    expect(none.sessionSeenAt('s1', 7)).toBe(7);

    const broken: KeyValueStorage = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn(() => {
        throw new Error('full');
      }),
    };
    const memory = createBrowserMemory(() => broken);
    expect(memory.extensionId()).toBeNull();
    expect(() => memory.rememberSignOut(1)).not.toThrow();
    expect(memory.websiteSignedOutAt()).toBe(0);
  });

  it('uses the site’s localStorage by default, and copes when reading it throws', () => {
    window.localStorage.clear();
    createBrowserMemory().rememberExtension(EXT);
    expect(window.localStorage.getItem(MEMORY_KEYS.extension)).toBe(EXT);

    const spy = vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    try {
      expect(createBrowserMemory().extensionId()).toBeNull();
    } finally {
      spy.mockRestore();
      window.localStorage.clear();
    }
  });
});
