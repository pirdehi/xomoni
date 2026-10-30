// Desktop notifications. The dashboard creates them; the service worker handles
// clicks, so a click still works after the dashboard tab is gone.

/** "X needs you" — clicking it brings up the worker window. */
export const ATTENTION_ID = 'xomoni-attention';
/** A job ended — clicking it opens the dashboard. */
export const FINISHED_ID = 'xomoni-finished';

/**
 * Shows a desktop notification, replacing one with the same id. `sticky` keeps it on screen at high priority
 * until the person acts. Never throws: failures are logged.
 */
export async function notify(id: string, title: string, message: string, sticky = false) {
  if (!chrome.notifications) return;
  try {
    // Replacing a notification in place doesn't alert again on every OS.
    await chrome.notifications.clear(id);
    await chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: sticky ? 2 : 0,
      requireInteraction: sticky,
    });
  } catch (err) {
    console.warn('[xomoni] notification failed', err);
  }
}

/** Removes a notification if it is showing; errors are ignored. */
export function clearNotification(id: string) {
  chrome.notifications?.clear(id).catch(() => undefined);
}
