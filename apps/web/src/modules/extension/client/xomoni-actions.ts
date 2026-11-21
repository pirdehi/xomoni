import type { ActionAnswer, ReadAnswer, SettingsAnswer } from '@xomoni/bridge';
import {
  type XomoniRead,
  type XomoniSettingsChange,
  askXomoni,
  changeXomoniSettings,
  readXomoni,
} from '../application/actions';

export type { XomoniRead, XomoniSettingsChange };
import type { XomoniRequest } from '../domain/presence';
import { createChromeExtensionChannel } from '../infrastructure/chrome-extension-channel';
import { createExtensionSessionServices, currentExtensionId } from './extension-session';

/** What a page can ask of Xomoni in this browser (ADR-0027, #251). */
export interface XomoniActionServices {
  /** Hands a request to Xomoni and returns its answer. */
  ask(request: XomoniRequest): Promise<ActionAnswer>;
  /** Looks for Xomoni again (a sync), after the person says they installed or signed in to it. */
  recheck(): Promise<void>;
  /** Reads one of Xomoni's places (ADR-0028); the answer stays in the page's memory. */
  read(read: XomoniRead): Promise<ReadAnswer>;
  /** Changes some of Xomoni's settings within its own rules (ADR-0029), answering them as stored. */
  settings(change: XomoniSettingsChange): Promise<SettingsAnswer>;
}

/**
 * Composition root in the browser for Xomoni's actions: the extension through `chrome.runtime`, at the id this page
 * talks to it at (`currentExtensionId`: where the last sync found it, a fixed id included, #302, else the one the site
 * remembers). `recheck` runs the one-sign-in sync, which also refreshes what pages know of the extension.
 */
export function createXomoniActionServices(): XomoniActionServices {
  const deps = { channel: createChromeExtensionChannel(), memory: { extensionId: currentExtensionId } };
  return {
    ask: (request) => askXomoni(deps, request),
    read: (read) => readXomoni(deps, read),
    settings: (change) => changeXomoniSettings(deps, change),
    async recheck() {
      await createExtensionSessionServices().sync();
    },
  };
}
