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
  const chrome = {
    runtime: {
      id: 'test-extension',
      getURL: vi.fn((path: string) => `chrome-extension://test-extension/${path}`),
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
