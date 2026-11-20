import type { ActionAnswer, ReadAnswer } from '@xomoni/bridge';
import { type XomoniRead, askXomoni, readXomoni } from '../application/actions';

export type { XomoniRead };
import type { XomoniRequest } from '../domain/presence';
import { createBrowserMemory } from '../infrastructure/browser-memory';
import { createChromeExtensionChannel } from '../infrastructure/chrome-extension-channel';
import { createExtensionSessionServices } from './extension-session';

/** What a page can ask of Xomoni in this browser (ADR-0027, #251). */
export interface XomoniActionServices {
  /** Hands a request to Xomoni and returns its answer. */
  ask(request: XomoniRequest): Promise<ActionAnswer>;
  /** Looks for Xomoni again (a sync), after the person says they installed or signed in to it. */
  recheck(): Promise<void>;
  /** Reads one of Xomoni's places (ADR-0028); the answer stays in the page's memory. */
  read(read: XomoniRead): Promise<ReadAnswer>;
}

/**
 * Composition root in the browser for Xomoni's actions: the extension through `chrome.runtime`, its id from this
 * browser's storage. `recheck` runs the one-sign-in sync, which also refreshes what pages know of the extension.
 */
export function createXomoniActionServices(): XomoniActionServices {
  const deps = { channel: createChromeExtensionChannel(), memory: createBrowserMemory() };
  return {
    ask: (request) => askXomoni(deps, request),
    read: (read) => readXomoni(deps, read),
    async recheck() {
      await createExtensionSessionServices().sync();
    },
  };
}
