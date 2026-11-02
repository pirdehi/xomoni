import { afterEach, describe, expect, it, vi } from 'vitest';
import { ATTENTION_ID, FINISHED_ID, clearNotification, notify } from '../src/shared/notify';
import { stubChrome } from './support/chrome';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A `chrome` without `chrome.notifications`, as in the UI preview. */
function stubChromeWithoutNotifications() {
  const chrome = { runtime: { getURL: vi.fn((path: string) => path) } };
  vi.stubGlobal('chrome', chrome);
  return chrome;
}

describe('notify', () => {
  it('replaces a notification with the same id by a quiet one', async () => {
    const chrome = stubChrome();

    await notify(FINISHED_ID, 'Xomoni: Finished “Delete old posts”', '3 done, 0 skipped, 0 failed.');

    expect(chrome.notifications.clear).toHaveBeenCalledWith(FINISHED_ID);
    expect(chrome.notifications.create).toHaveBeenCalledExactlyOnceWith(FINISHED_ID, {
      type: 'basic',
      iconUrl: 'chrome-extension://test-extension/icons/icon128.png',
      title: 'Xomoni: Finished “Delete old posts”',
      message: '3 done, 0 skipped, 0 failed.',
      priority: 0,
      requireInteraction: false,
    });
    expect(chrome.notifications.clear.mock.invocationCallOrder[0]).toBeLessThan(
      chrome.notifications.create.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps a sticky notification on screen at high priority until the person acts', async () => {
    const chrome = stubChrome();

    await notify(ATTENTION_ID, 'Xomoni needs you: Log in to X', 'Log in to X.', true);

    expect(chrome.notifications.create).toHaveBeenCalledWith(
      ATTENTION_ID,
      expect.objectContaining({ priority: 2, requireInteraction: true }),
    );
  });

  it('never throws: a failure is only logged', async () => {
    const chrome = stubChrome();
    const failure = new Error('Notifications are blocked');
    chrome.notifications.create.mockRejectedValueOnce(failure);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(notify(FINISHED_ID, 'title', 'message')).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith('[xomoni] notification failed', failure);
  });

  it('does nothing where the notifications API is missing', async () => {
    const chrome = stubChromeWithoutNotifications();

    await expect(notify(FINISHED_ID, 'title', 'message')).resolves.toBeUndefined();
    expect(chrome.runtime.getURL).not.toHaveBeenCalled();
  });
});

describe('clearNotification', () => {
  it('removes the notification', () => {
    const chrome = stubChrome();

    clearNotification(ATTENTION_ID);

    expect(chrome.notifications.clear).toHaveBeenCalledExactlyOnceWith(ATTENTION_ID);
  });

  it('ignores a failure to remove it', async () => {
    const chrome = stubChrome();
    chrome.notifications.clear.mockRejectedValueOnce(new Error('No such notification'));
    const warn = vi.spyOn(console, 'warn');

    expect(() => clearNotification(ATTENTION_ID)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warn).not.toHaveBeenCalled();
  });

  it('does nothing where the notifications API is missing', () => {
    stubChromeWithoutNotifications();
    expect(() => clearNotification(ATTENTION_ID)).not.toThrow();
  });
});

describe('notification ids', () => {
  it('are distinct, so a finished job never replaces an “X needs you” notification', () => {
    expect(ATTENTION_ID).not.toBe(FINISHED_ID);
  });
});
