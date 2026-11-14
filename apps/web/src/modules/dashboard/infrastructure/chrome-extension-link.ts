import type { ExtensionLink } from '../application/ports';
import type { PairMessage } from '../domain/connect';

/**
 * The part of `chrome.runtime` Chrome gives a web page when an installed extension lists the page's origin in
 * `externally_connectable`; undefined otherwise (no such extension, or another browser).
 */
export interface PageRuntime {
  sendMessage(extensionId: string, message: unknown, callback: (answer: unknown) => void): void;
  lastError?: { message?: string };
}

/** `chrome.runtime` as this page sees it, if Chrome exposes it. */
function pageRuntime(): PageRuntime | undefined {
  return (globalThis as { chrome?: { runtime?: PageRuntime } }).chrome?.runtime;
}

/**
 * `ExtensionLink` over `chrome.runtime.sendMessage` (#228). Rejects when Chrome exposes no runtime to the page, when
 * the extension isn't there (`lastError`), or after `timeoutMs` without an answer.
 */
export function createChromeExtensionLink(
  runtime: () => PageRuntime | undefined = pageRuntime,
  timeoutMs = 30_000,
): ExtensionLink {
  return {
    send(extensionId: string, message: PairMessage) {
      return new Promise((resolve, reject) => {
        const chromeRuntime = runtime();
        if (typeof chromeRuntime?.sendMessage !== 'function') {
          reject(new Error('Xomoni isn’t reachable from this page.'));
          return;
        }
        const timer = setTimeout(() => reject(new Error('Xomoni didn’t answer.')), timeoutMs);
        try {
          chromeRuntime.sendMessage(extensionId, message, (answer) => {
            clearTimeout(timer);
            const failed = chromeRuntime.lastError;
            if (failed) reject(new Error(failed.message ?? 'Xomoni isn’t reachable.'));
            else resolve(answer);
          });
        } catch (err) {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
  };
}
