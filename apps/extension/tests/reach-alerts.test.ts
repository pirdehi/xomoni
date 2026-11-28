import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usesBannedReachWord } from '@xomoni/bridge';
import { db, itemKey, kvSet } from '../src/shared/db';
import { REACH_ID, reachNotificationAccount, reachNotificationId } from '../src/shared/notification-ids';
import {
  REACH_DROP_MIN_POSTS,
  accountReachDrop,
  alertLabelChanges,
  notifyReachDrop,
  reachDropAlertsOn,
  reachDropNotifiedKey,
  setReachDropAlerts,
  labelAlertWords,
  labelSeen,
  markLabelsSeen,
  reachDrop,
  unseenLabelMonths,
} from '../src/shared/vault/reach-alerts';
import type { DailyReach } from '../src/shared/vault/reach';
import type { LabelChange } from '../src/shared/vault/under-the-hood';
import { resetDb } from './support/fixtures';

// Reach's alerts (#430, P5.3.1): a new or larger label notified once per month, the months not yet seen on Reach, and
// the note when the daily views fall under 0.6 of the 8 weeks before, with at least 5 posts.

const ME = { id: '9000000000000000001', handle: 'xomoni_fixture' };
const spam = (count: number, before = 0): LabelChange => ({ name: 'SPAM_HIGH_RECALL', scope: 'posts', count, before });

beforeEach(resetDb);

describe('the label notification', () => {
  it('says what X applied in Xomoni’s words, with how many more, never a verdict', () => {
    expect(labelAlertWords('me', '2026-07', [spam(3)])).toEqual({
      title: 'X’s report for July 2026: a new label for @me',
      message:
        'X applied SPAM_HIGH_RECALL to 3 posts in July 2026. See them on Reach, with what each means. Nothing was sent anywhere.',
    });
    const two = labelAlertWords('me', '2026-07', [spam(3), { name: 'NSFW', scope: 'account', count: 1, before: 0 }]);
    expect(two?.title).toBe('X’s report for July 2026: new labels for @me');
    expect(two?.message).toContain(', and 1 more label.');
    expect(labelAlertWords('me', '2026-07', [])).toBeNull();
    for (const words of [two?.title ?? '', two?.message ?? '']) expect(usesBannedReachWord(words)).toBe(false);
  });

  it('is shown once per account and month, even for a newer file of the same month', async () => {
    const show = vi.fn(() => Promise.resolve());
    expect(await alertLabelChanges(ME, '2026-07', [spam(3)], 'id', show)).not.toBeNull();
    expect(await alertLabelChanges(ME, '2026-07', [spam(5, 3)], 'id', show)).toBeNull();
    expect(show).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith('id', expect.stringContaining('July 2026'), expect.stringContaining('3 posts'));
    await alertLabelChanges(ME, '2026-08', [spam(1)], 'id', show);
    await alertLabelChanges({ id: '9000000000000000002', handle: 'b' }, '2026-07', [spam(1)], 'id', show);
    expect(show).toHaveBeenCalledTimes(3);
  });

  it('says nothing without a change', async () => {
    const show = vi.fn(() => Promise.resolve());
    expect(await alertLabelChanges(ME, '2026-07', [], 'id', show)).toBeNull();
    expect(show).not.toHaveBeenCalled();
  });
});

describe('the months not seen yet', () => {
  const months = [
    { month: '2026-09', labels: [{ name: 'A', count: 1, scope: 'posts' as const }] },
    { month: '2026-08', labels: [] },
    { month: '2026-07', labels: [{ name: 'A', count: 2, scope: 'posts' as const }] },
  ];

  it('counts the months with a label newer than the one seen, all of them before any is seen', async () => {
    expect(unseenLabelMonths(months, null)).toBe(2);
    expect(unseenLabelMonths(months, '2026-07')).toBe(1);
    expect(unseenLabelMonths(months, '2026-09')).toBe(0);
  });

  it('remembers the newest month seen, and never moves back', async () => {
    expect(await labelSeen(ME.id)).toBeNull();
    await markLabelsSeen(ME.id, '2026-09');
    await markLabelsSeen(ME.id, '2026-07');
    expect(await labelSeen(ME.id)).toBe('2026-09');
  });
});

describe('the note when reach drops', () => {
  /** `days` days of `views` each, ending `from` days before 2026-11-28. */
  const days = (from: number, count: number, views: number): DailyReach[] =>
    Array.from({ length: count }, (_, i) => ({
      day: new Date(Date.UTC(2026, 10, 28) - (from + i) * 86_400_000).toISOString().slice(0, 10),
      views,
      estimate: true as const,
    }));
  const series = (recent: number) => [...days(7, 56, 1_000), ...days(0, 7, recent)];

  it('notes a fall under 0.6 of the 8 weeks before, with at least 5 posts', () => {
    expect(reachDrop(series(500), '2026-11-28', 5)).toEqual({ recent: 500, usual: 1_000, ratio: 0.5 });
    expect(reachDrop(series(599), '2026-11-28', 9)?.ratio).toBeCloseTo(0.599);
  });

  it('says nothing at 0.6 or above, with fewer than 5 posts, or without numbers enough on either side', () => {
    expect(reachDrop(series(600), '2026-11-28', 9)).toBeNull();
    expect(reachDrop(series(100), '2026-11-28', REACH_DROP_MIN_POSTS - 1)).toBeNull();
    expect(reachDrop(days(0, 7, 100), '2026-11-28', 9)).toBeNull();
    expect(reachDrop([...days(7, 56, 1_000), ...days(0, 3, 100)], '2026-11-28', 9)).toBeNull();
    expect(reachDrop([...days(7, 56, 0), ...days(0, 7, 0)], '2026-11-28', 9)).toBeNull();
    expect(reachDrop(series(100), 'today', 9)).toBeNull();
  });
});

describe('the drop, read from the database, and its weekly notification', () => {
  const NOW = Date.UTC(2026, 10, 28, 12);
  const DAY = 86_400_000;

  /** 63 days of daily numbers: 1,000 views a day, then `recent` a day for the last 7; and `posts` posts this week. */
  async function seed(recent: number, posts: number) {
    await db.daily.bulkPut(
      Array.from({ length: 63 }, (_, i) => {
        const day = new Date(NOW - i * DAY);
        return {
          accountId: ME.id,
          day: `${String(day.getFullYear())}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
          receivedViews: i < 7 ? recent : 1_000,
        } as never;
      }),
    );
    await db.items.bulkPut(
      Array.from({ length: posts }, (_, i) => ({
        key: itemKey(ME.id, 'post', String(i)),
        accountId: ME.id,
        kind: 'post',
        id: String(i),
        targetId: String(i),
        createdAt: NOW - (i + 1) * 3_600_000,
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
        seenAt: NOW,
        statusAt: NOW,
        lastJobId: null,
      })) as never,
    );
  }

  it('finds a drop from the daily numbers and the week’s posts, and none with too few posts', async () => {
    await seed(400, 6);
    expect((await accountReachDrop(ME.id, NOW))?.ratio).toBeCloseTo(0.4);
    await db.items.clear();
    await seed(400, 4);
    expect(await accountReachDrop(ME.id, NOW)).toBeNull();
  });

  it('notifies only when the person asked, at most once a week', async () => {
    await seed(400, 6);
    const show = vi.fn(() => Promise.resolve());
    const id = reachNotificationId(ME.id);
    expect(await reachDropAlertsOn(ME.id)).toBe(false);
    expect(await notifyReachDrop(ME, NOW, id, show)).toBeNull();
    await setReachDropAlerts(ME.id, true);
    expect(await notifyReachDrop(ME, NOW, id, show)).not.toBeNull();
    expect(show).toHaveBeenCalledWith(id, '@xomoni_fixture’s views fell this week', expect.stringContaining('40%'));
    expect(await notifyReachDrop(ME, NOW + 6 * DAY, id, show)).toBeNull();
    expect(show).toHaveBeenCalledOnce();
    await kvSet(reachDropNotifiedKey(ME.id), NOW - 8 * DAY);
    expect(await notifyReachDrop(ME, NOW, id, show)).not.toBeNull();
  });

  it('names the account in the notification’s id, and reads it back', () => {
    expect(reachNotificationAccount(reachNotificationId(ME.id))).toBe(ME.id);
    expect(reachNotificationAccount(`${REACH_ID}:`)).toBeNull();
    expect(reachNotificationAccount('xomoni-vault:1')).toBeNull();
  });
});
