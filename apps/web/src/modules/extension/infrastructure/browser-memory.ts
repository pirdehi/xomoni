import { isExtensionId } from '@xomoni/bridge';
import type { BrowserMemory } from '../application/ports';

/** The keys in the site's `localStorage`. None holds a secret or anything from X. */
export const MEMORY_KEYS = {
  extension: 'xomoni.extension',
  signedOutAt: 'xomoni.signedOutAt',
  session: 'xomoni.session',
} as const;

/** The part of `Storage` this adapter uses. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** `localStorage`, or null where it can't be used (blocked site data, some private windows). */
function siteStorage(): KeyValueStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * `BrowserMemory` in the site's own storage. Every read is checked and every failure ignored: with storage blocked,
 * the site still works, it only can't find the extension or tell a new session from an old one.
 */
export function createBrowserMemory(storage: () => KeyValueStorage | null = siteStorage): BrowserMemory {
  const read = (key: string): string | null => {
    try {
      return storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string) => {
    try {
      storage()?.setItem(key, value);
    } catch {
      // Storage full or blocked: the sync works without it.
    }
  };
  const epoch = (raw: string | null) => {
    const value = Number(raw);
    return raw && Number.isFinite(value) && value > 0 ? value : 0;
  };
  return {
    extensionId() {
      const id = read(MEMORY_KEYS.extension);
      return isExtensionId(id) ? id : null;
    },
    rememberExtension(extensionId) {
      if (isExtensionId(extensionId)) write(MEMORY_KEYS.extension, extensionId);
    },
    websiteSignedOutAt() {
      return epoch(read(MEMORY_KEYS.signedOutAt));
    },
    rememberSignOut(at) {
      write(MEMORY_KEYS.signedOutAt, String(at));
    },
    sessionSeenAt(sessionId, now) {
      try {
        const seen = JSON.parse(read(MEMORY_KEYS.session) ?? 'null') as { id?: unknown; at?: unknown } | null;
        if (seen?.id === sessionId && typeof seen.at === 'number' && seen.at > 0) return seen.at;
      } catch {
        // Unreadable: this session counts as new.
      }
      write(MEMORY_KEYS.session, JSON.stringify({ id: sessionId, at: now }));
      return now;
    },
  };
}
