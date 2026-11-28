// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, itemKey, kvGet } from '../../src/shared/db';
import { localDay } from '../../src/shared/daily';
import { reachNotificationId } from '../../src/shared/notification-ids';
import { reachDropAlertsKey, setReachDropAlerts } from '../../src/shared/vault/reach-alerts';
import { ReachFollowUp } from '../../src/ui/components/ReachFollowUp';
import { ReachDropNote } from '../../src/ui/components/reach/ReachDropNote';
import { FluentRoot } from '../../src/ui/fluent';
import { resetDb } from '../support/fixtures';

// Reach's drop note and its weekly notification (#430, P5.3.1): the note with its estimate and what may go with it,
// the switch off unless turned on, and one notification a week while the dashboard is open.

const ME = { id: '9000000000000000001', handle: 'xomoni_fixture' };
const DAY = 86_400_000;

/** 63 days of daily numbers up to now: 1,000 views a day, then `recent` for the last 7; and 6 posts this week. */
async function seed(recent: number) {
  const now = Date.now();
  await db.daily.bulkPut(
    Array.from({ length: 63 }, (_, i) => ({
      accountId: ME.id,
      day: localDay(now - i * DAY),
      receivedViews: i < 7 ? recent : 1_000,
    })) as never,
  );
  await db.items.bulkPut(
    Array.from({ length: 6 }, (_, i) => ({
      key: itemKey(ME.id, 'post', String(i)),
      accountId: ME.id,
      kind: 'post',
      id: String(i),
      targetId: String(i),
      createdAt: now - (i + 1) * 3_600_000,
      likedAt: null,
      text: '',
      author: 'me',
      inReplyToId: null,
      selfReply: false,
      likes: 0,
      reposts: 0,
      replies: 0,
      sources: ['scan'],
      status: 'present',
      seenAt: now,
      statusAt: now,
      lastJobId: null,
    })) as never,
  );
}

beforeEach(resetDb);
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ReachDropNote', () => {
  it('says how far the views fell, as an estimate, what may go with it, and never why', async () => {
    await seed(400);
    render(
      <FluentRoot>
        <ReachDropNote accountId={ME.id} />
      </FluentRoot>,
    );
    expect(await screen.findByText('Your views fell this week')).toBeInTheDocument();
    expect(screen.getByText(/About 400 views a day over the last 7 days, against 1,000 a day/)).toHaveTextContent(
      '40% of your usual',
    );
    expect(screen.getByText('Estimate')).toBeInTheDocument();
    expect(screen.getByText('What may go with it, not why:')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/shadowban|penal|suppress|throttl/i);
  });

  it('without a drop, offers only the switch, off until the person turns it on', async () => {
    await seed(900);
    render(
      <FluentRoot>
        <ReachDropNote accountId={ME.id} />
      </FluentRoot>,
    );
    expect(await screen.findByText('When your reach drops')).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Tell me when my reach drops' });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await vi.waitFor(async () => expect(await kvGet(reachDropAlertsKey(ME.id), false)).toBe(true));
    expect(await screen.findByRole('switch', { name: 'Tell me when my reach drops' })).toBeChecked();
  });
});

describe('ReachFollowUp', () => {
  it('notifies a drop once a week, and only when asked', async () => {
    await seed(400);
    const show = vi.fn(() => Promise.resolve());
    render(<ReachFollowUp account={ME} everyMs={1_000} show={show} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_300));
    });
    expect(show).not.toHaveBeenCalled();
    await setReachDropAlerts(ME.id, true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_300));
    });
    expect(show).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith(
      reachNotificationId(ME.id),
      '@xomoni_fixture’s views fell this week',
      expect.any(String),
    );
  });
});
