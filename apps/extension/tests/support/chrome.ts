import { vi } from 'vitest';

/** The worker tab the stub reports, when one is open. */
export const WORKER_TAB = { id: 7, windowId: 3 };

/**
 * A minimal `chrome` for dashboard tests: every API the dashboard calls, as `vi.fn` mocks that answer like
 * Chrome does with no worker tab open. Tests override single methods, e.g.
 * `chrome.tabs.sendMessage.mockResolvedValue(page)`. Installed with `vi.stubGlobal`; undo with
 * `vi.unstubAllGlobals()`.
 */
export function stubChrome() {
  // chrome.storage.local, in memory, with change events like Chrome's.
  const local = new Map<string, unknown>();
  const changeListeners = new Set<
    (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void
  >();
  const emit = (key: string, oldValue: unknown, newValue: unknown) => {
    for (const listener of changeListeners) listener({ [key]: { oldValue, newValue } }, 'local');
  };
  const chrome = {
    runtime: {
      id: 'test-extension',
      getURL: vi.fn((path: string) => `chrome-extension://test-extension/${path}`),
      getManifest: vi.fn(() => ({ version: '0.3.0' })),
      sendMessage: vi.fn(() => Promise.resolve(undefined)),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      get: vi.fn((): Promise<typeof WORKER_TAB> => Promise.reject(new Error('No tab with id'))),
      update: vi.fn(() => Promise.resolve(WORKER_TAB)),
      sendMessage: vi.fn((): Promise<unknown> => Promise.reject(new Error('Could not establish connection'))),
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    windows: {
      create: vi.fn(() => Promise.resolve({ id: WORKER_TAB.windowId, tabs: [WORKER_TAB] })),
      get: vi.fn(() => Promise.resolve({ id: WORKER_TAB.windowId, state: 'normal' })),
      update: vi.fn(() => Promise.resolve(undefined)),
    },
    notifications: {
      create: vi.fn(() => Promise.resolve('')),
      clear: vi.fn(() => Promise.resolve(true)),
    },
    storage: {
      local: {
        get: vi.fn((key: string) => Promise.resolve(local.has(key) ? { [key]: local.get(key) } : {})),
        set: vi.fn((items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) {
            const old = local.get(key);
            local.set(key, value);
            emit(key, old, value);
          }
          return Promise.resolve();
        }),
        remove: vi.fn((key: string) => {
          const old = local.get(key);
          local.delete(key);
          emit(key, old, undefined);
          return Promise.resolve();
        }),
      },
      onChanged: {
        addListener: vi.fn((listener: Parameters<typeof changeListeners.add>[0]) => changeListeners.add(listener)),
        removeListener: vi.fn((listener: Parameters<typeof changeListeners.add>[0]) =>
          changeListeners.delete(listener),
        ),
      },
      session: {
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve(undefined)),
        remove: vi.fn(() => Promise.resolve(undefined)),
      },
    },
  };
  vi.stubGlobal('chrome', chrome);
  return chrome;
}
