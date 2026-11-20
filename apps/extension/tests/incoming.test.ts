import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, forgetAccount, upsertAccount, wipeLocalData } from '../src/shared/db';
import { INCOMING_MAX, INCOMING_TEXT, incomingKey, incomingSince, saveIncoming } from '../src/shared/incoming';
import type { IncomingDraft } from '../src/shared/types';
import { ME, account, resetDb } from './support/fixtures';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const DAY = 86_400_000;
const OTHER = '2000';

const reply = (n: number, over: Partial<IncomingDraft> = {}): IncomingDraft => ({
  id: String(1_000_000 + n),
  author: 'bob',
  text: `reply ${n}`,
  createdAt: NOW - n * 60_000,
  toId: '500',
  ...over,
});

beforeEach(async () => {
  await resetDb();
  await upsertAccount(account());
});

describe('replies to you, kept on this computer (ADR-0030)', () => {
  it('keeps them by account, cuts long texts, and replaces what it kept when a reply is seen again', async () => {
    await saveIncoming(ME, [reply(1, { text: 'x'.repeat(INCOMING_TEXT + 500) }), reply(2)], NOW);
    await saveIncoming(ME, [reply(2, { text: 'edited' })], NOW);
    expect(await db.incoming.count()).toBe(2);
    expect((await db.incoming.get(incomingKey(ME, reply(1).id)))?.text).toHaveLength(INCOMING_TEXT);
    expect(await db.incoming.get(incomingKey(ME, reply(2).id))).toEqual({
      ...reply(2),
      text: 'edited',
      key: incomingKey(ME, reply(2).id),
      accountId: ME,
    });
  });

  it('keeps 90 days, dropping older ones as it saves, and never takes in one already too old', async () => {
    await saveIncoming(ME, [reply(1, { createdAt: NOW - 80 * DAY }), reply(2)], NOW);
    await saveIncoming(ME, [reply(3, { createdAt: NOW - 91 * DAY })], NOW);
    expect(await db.incoming.count()).toBe(2);
    // Twenty days later the 80-day-old reply is past the window and goes with the next save.
    await saveIncoming(ME, [reply(4, { createdAt: NOW })], NOW + 20 * DAY);
    expect((await db.incoming.toArray()).map((r) => r.id).sort()).toEqual([reply(2).id, reply(4).id].sort());
    expect(incomingSince(NOW)).toBe(NOW - 90 * DAY);
  });

  it('keeps only the newest 5,000 of an account, and leaves other accounts alone', async () => {
    await saveIncoming(OTHER, [reply(1)], NOW);
    await saveIncoming(
      ME,
      Array.from({ length: INCOMING_MAX + 5 }, (_, i) => reply(i + 1, { createdAt: NOW - (i + 1) * 1_000 })),
      NOW,
    );
    expect(await db.incoming.where('accountId').equals(ME).count()).toBe(INCOMING_MAX);
    expect(await db.incoming.get(incomingKey(ME, reply(INCOMING_MAX + 5).id))).toBeUndefined();
    expect(await db.incoming.get(incomingKey(ME, reply(1).id))).toBeDefined();
    expect(await db.incoming.where('accountId').equals(OTHER).count()).toBe(1);
  }, 30_000);

  it('goes with the account’s data, and with all local data', async () => {
    await saveIncoming(ME, [reply(1)], NOW);
    await saveIncoming(OTHER, [reply(2)], NOW);
    await forgetAccount(ME);
    expect((await db.incoming.toArray()).map((r) => r.accountId)).toEqual([OTHER]);
    await wipeLocalData();
    expect(await db.incoming.count()).toBe(0);
  });
});
