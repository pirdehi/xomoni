// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kvSet } from '../../src/shared/db';
import { vaultNotificationId } from '../../src/shared/notification-ids';
import { NOT_NOW, snoozeVault } from '../../src/shared/vault/freshness';
import { recordImport } from '../../src/shared/vault/db';
import { VaultFollowUp } from '../../src/ui/components/VaultFollowUp';
import { resetDb } from '../support/fixtures';

// The vault's reminder while the dashboard is open (#425, CV.2.3), with fake time: one notification a day, *Not now*,
// active hours, and a browser without notifications.

const ME = { id: '9000000000000000001', handle: 'xomoni_fixture' };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 10:00 local time, inside the default active hours (8 to 23). */
const START = new Date(2026, 10, 20, 10).getTime();

async function archiveFrom(days: number) {
  await recordImport(
    {
      accountId: ME.id,
      source: 'x-archive',
      fileName: 'twitter.zip',
      bytes: 1,
      fingerprint: 'zip:00112233445566778899aabbccddeeff',
      importedAt: START - days * DAY,
      coverFrom: null,
      coverTo: START - days * DAY,
      counts: { read: 1, merged: 1, skipped: 0 },
      parser: 'x-archive@1',
      problems: [],
    },
    START,
  );
}

/** Lets fake time run `ms` and the reminder's database work finish. */
async function pass(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await act(async () => {
    await vi.waitFor(() => Promise.resolve(), { timeout: 50 });
  });
}

beforeEach(async () => {
  await resetDb();
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'setInterval', 'Date'] });
  vi.setSystemTime(START);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('VaultFollowUp', () => {
  it('shows one reminder a few seconds after the dashboard opens, then none until tomorrow', async () => {
    await archiveFrom(40);
    const show = vi.fn(() => Promise.resolve());
    const { container } = render(<VaultFollowUp account={ME} everyMs={HOUR} show={show} />);
    expect(container).toBeEmptyDOMElement();
    await pass(5_000);
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    expect(show).toHaveBeenCalledWith(
      vaultNotificationId(ME.id),
      'Time for a fresh copy of @xomoni_fixture’s X files',
      expect.stringContaining('X’s archive is 40 days old'),
      false,
      [NOT_NOW],
    );
    await pass(5 * HOUR);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('says nothing before anything is due', async () => {
    await archiveFrom(10);
    const show = vi.fn(() => Promise.resolve());
    render(<VaultFollowUp account={ME} everyMs={HOUR} show={show} />);
    await pass(3 * HOUR);
    expect(show).not.toHaveBeenCalled();
  });

  it('stays quiet after Not now', async () => {
    await archiveFrom(40);
    await snoozeVault(ME.id, START);
    const show = vi.fn(() => Promise.resolve());
    render(<VaultFollowUp account={ME} everyMs={HOUR} show={show} />);
    await pass(2 * HOUR);
    expect(show).not.toHaveBeenCalled();
  });

  it('waits for active hours', async () => {
    await archiveFrom(40);
    await kvSet('settings', { activeHours: { enabled: true, start: 14, end: 15 } });
    const show = vi.fn(() => Promise.resolve());
    render(<VaultFollowUp account={ME} everyMs={HOUR} show={show} />);
    await pass(2 * HOUR);
    expect(show).not.toHaveBeenCalled();
    // 14:00 and later.
    await pass(3 * HOUR);
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(1));
  });

  it('keeps going when the browser can’t show a notification', async () => {
    await archiveFrom(40);
    const show = vi.fn(() => Promise.reject(new Error('No notifications here')));
    render(<VaultFollowUp account={ME} everyMs={HOUR} show={show} />);
    await pass(5_000);
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    await pass(HOUR);
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(2));
  });
});
