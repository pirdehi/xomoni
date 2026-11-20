import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { READ } from '@xomoni/bridge';
import { type CloudConnection, saveConnection } from '../src/cloud/connection';
import { answerRead, readHealth, readLibrary, readWatch } from '../src/cloud/website-reads';
import { db, kvSet, recordRisk, saveWatchResult, saveWatchTabs, upsertAccount, upsertItems } from '../src/shared/db';
import { markSignedOut } from '../src/shared/session';
import type { ItemDraft } from '../src/shared/types';
import { stubChrome } from './support/chrome';
import { ME, account, resetDb } from './support/fixtures';

const DEVICE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const CONNECTED: CloudConnection = {
  deviceId: DEVICE,
  token: 'tok',
  deviceName: 'Chrome',
  connectedAt: 1,
  reportedUpTo: 0,
  account: 'a•••@example.com',
  confirmed: true,
};

function draft(over: Partial<ItemDraft>): ItemDraft {
  return {
    kind: 'post',
    id: '1',
    targetId: '1',
    createdAt: Date.UTC(2024, 0, 1),
    likedAt: null,
    text: 'hello world',
    author: 'me',
    inReplyToId: null,
    selfReply: false,
    likes: 1,
    reposts: 0,
    replies: 0,
    ...over,
  };
}

beforeEach(async () => {
  stubChrome();
  await resetDb();
  await saveConnection(CONNECTED);
  await upsertAccount(account());
  await kvSet('activeAccount', ME);
});
afterEach(() => vi.unstubAllGlobals());

describe('answerRead: who it answers (ADR-0028)', () => {
  it('refuses a page of another account, a browser not connected, and while signed out', async () => {
    const read = { type: READ, what: 'health', deviceId: DEVICE } as const;
    await expect(answerRead({ ...read, deviceId: '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f' })).resolves.toEqual({
      ok: false,
      reason: 'other_account',
    });
    await markSignedOut('me', true);
    await expect(answerRead(read)).resolves.toEqual({ ok: false, reason: 'signed_out' });
    await db.kv.clear();
    await expect(answerRead(read)).resolves.toEqual({ ok: false, reason: 'not_connected' });
  });

  it('answers each read it knows, and changes nothing', async () => {
    await upsertItems(ME, [draft({ id: '10' })], 'archive');
    const before = await db.items.toArray();
    const library = await answerRead({
      type: READ,
      what: 'library',
      deviceId: DEVICE,
      kind: 'post',
      query: '',
      offset: 0,
    });
    expect(library).toMatchObject({ ok: true, what: 'library', page: { handle: 'me', matching: 1 } });
    await expect(answerRead({ type: READ, what: 'health', deviceId: DEVICE })).resolves.toMatchObject({
      ok: true,
      what: 'health',
    });
    await expect(answerRead({ type: READ, what: 'watch', deviceId: DEVICE })).resolves.toMatchObject({
      ok: true,
      what: 'watch',
    });
    expect(await db.items.toArray()).toEqual(before);
  });
});

describe('readLibrary (#233)', () => {
  it('counts each kind, present and removed, and pages one kind newest first', async () => {
    const drafts = Array.from({ length: 105 }, (_, i) =>
      draft({ id: String(1000 + i), createdAt: Date.UTC(2024, 0, 1) + i * 1000 }),
    );
    await upsertItems(ME, drafts, 'archive');
    await upsertItems(ME, [draft({ kind: 'like', id: '7', author: 'someone', text: 'liked' })], 'archive');
    await db.items.update(`${ME}:post:1000`, { status: 'deleted' });

    const first = await readLibrary('post', '', 0);
    expect(first.counts.post).toEqual({ present: 104, removed: 1 });
    expect(first.counts.like).toEqual({ present: 1, removed: 0 });
    expect(first.matching).toBe(105);
    expect(first.items).toHaveLength(100);
    expect(first.items[0]?.id).toBe('1104');
    expect(first.next).toBe(100);

    const last = await readLibrary('post', '', 100);
    expect(last.items.map((i) => i.id)).toEqual(['1004', '1003', '1002', '1001', '1000']);
    expect(last.items.at(-1)?.removed).toBe(true);
    expect(last.next).toBeNull();
  });

  it('searches the text and the author, ignoring case, links a repost to its original, and cuts long text', async () => {
    await upsertItems(
      ME,
      [
        draft({ id: '1', text: 'About Rust and TypeScript' }),
        draft({ id: '2', text: 'nothing here' }),
        draft({ kind: 'repost', id: '3', targetId: '99', author: 'rustlang', text: 'a repost' }),
        draft({ id: '4', text: 'x'.repeat(1500) }),
      ],
      'archive',
    );
    expect((await readLibrary('post', 'rust', 0)).items.map((i) => i.id)).toEqual(['1']);
    const reposts = await readLibrary('repost', 'RUSTLANG', 0);
    expect(reposts.items).toEqual([expect.objectContaining({ kind: 'repost', id: '99', author: 'rustlang' })]);
    expect((await readLibrary('post', '', 0)).items.find((i) => i.id === '4')?.text).toHaveLength(1000);
  });

  it('answers an empty Library when no X account is known yet', async () => {
    await db.accounts.clear();
    await db.kv.delete('activeAccount');
    expect(await readLibrary('post', '', 0)).toMatchObject({ handle: '', matching: 0, items: [], next: null });
  });
});

describe('readHealth and readWatch (#233)', () => {
  it('gives each account’s level, reason and pace', async () => {
    await recordRisk(ME, 'automation_flag');
    const [health] = await readHealth();
    expect(health).toMatchObject({ handle: 'me', level: 2, pace: 0.5, fullStop: false });
    expect(health?.reason).not.toBe('');
  });

  it('gives each Watch tab with its last look, and none without an account', async () => {
    await saveWatchTabs(ME, [{ id: 't1', query: 'xomoni' }]);
    await saveWatchResult(ME, 't1', {
      query: 'xomoni',
      checkedAt: 5,
      error: '',
      posts: [{ id: '42', handle: 'ada', name: 'Ada', text: 'about xomoni', time: 4 }],
    });
    const tabs = await readWatch();
    expect(tabs.find((t) => t.query === 'xomoni')).toEqual({
      query: 'xomoni',
      checkedAt: 5,
      error: '',
      posts: [{ id: '42', handle: 'ada', name: 'Ada', text: 'about xomoni', time: 4 }],
    });
    await db.accounts.clear();
    await db.kv.delete('activeAccount');
    expect(await readWatch()).toEqual([]);
  });
});
