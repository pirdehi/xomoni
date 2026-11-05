import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, itemKey, kvGet } from '../src/shared/db';
import type { RuntimeMessage } from '../src/shared/messages';
import { ATTENTION_ID, FINISHED_ID } from '../src/shared/notify';
import type { ItemDraft, RateObservation } from '../src/shared/types';
import { account, resetDb } from './support/fixtures';

type Sender = { id?: string; origin?: string; url?: string; frameId?: number; tab?: { id: number } };
type Listeners = {
  action?: () => void;
  notification?: (id: string) => void;
  installed?: (details: { reason: string }) => void;
  message?: (message: RuntimeMessage, sender: Sender) => unknown;
};
type Context = { documentUrl?: string; tabId: number; windowId: number };

const DASHBOARD = 'chrome-extension://xomoni/dashboard.html';
const EXTENSION_ID = 'xomoni';
/** An X account id; observations name accounts by X's numeric ids (#145). */
const X_ME = '1000';
const WORKER = { id: 7, windowId: 3 };

/** The listeners the service worker registered when it started. */
const on: Listeners = {};

/** The `chrome` APIs the service worker uses; the listeners it registers land in `on`. */
const chrome = {
  runtime: {
    id: EXTENSION_ID,
    getURL: vi.fn((path: string) => `chrome-extension://xomoni/${path}`),
    getContexts: vi.fn((): Promise<Context[]> => Promise.resolve([])),
    ContextType: { TAB: 'TAB' },
    onInstalled: { addListener: (listener: Listeners['installed']) => (on.installed = listener) },
    onMessage: { addListener: (listener: Listeners['message']) => (on.message = listener) },
  },
  action: { onClicked: { addListener: (listener: Listeners['action']) => (on.action = listener) } },
  notifications: {
    onClicked: { addListener: (listener: Listeners['notification']) => (on.notification = listener) },
    clear: vi.fn((): Promise<boolean> => Promise.resolve(true)),
  },
  storage: { session: { get: vi.fn((): Promise<Record<string, unknown>> => Promise.resolve({})) } },
  tabs: {
    get: vi.fn((id: number) => Promise.resolve({ id, windowId: WORKER.windowId })),
    update: vi.fn(() => Promise.resolve({})),
    create: vi.fn(() => Promise.resolve({})),
  },
  windows: {
    get: vi.fn((): Promise<{ id: number; state: string }> => Promise.resolve({ id: WORKER.windowId, state: 'normal' })),
    update: vi.fn(() => Promise.resolve({})),
  },
};

beforeAll(async () => {
  vi.stubGlobal('chrome', chrome);
  await import('../src/background/sw');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  vi.resetAllMocks();
  chrome.runtime.getURL.mockImplementation((path: string) => `chrome-extension://xomoni/${path}`);
  chrome.runtime.getContexts.mockResolvedValue([]);
  chrome.notifications.clear.mockResolvedValue(true);
  chrome.storage.session.get.mockResolvedValue({});
  chrome.tabs.get.mockImplementation((id: number) => Promise.resolve({ id, windowId: WORKER.windowId }));
  chrome.tabs.update.mockResolvedValue({});
  chrome.tabs.create.mockResolvedValue({});
  chrome.windows.get.mockResolvedValue({ id: WORKER.windowId, state: 'normal' });
  chrome.windows.update.mockResolvedValue({});
  await resetDb();
});

/** Lets the service worker's fire-and-forget handlers finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('service worker: opening the dashboard', () => {
  it('opens the dashboard when the toolbar button is clicked', async () => {
    on.action!();

    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: DASHBOARD }));
    expect(chrome.runtime.getContexts).toHaveBeenCalledWith({ contextTypes: ['TAB'] });
  });

  it('brings an open dashboard to the front instead of opening another', async () => {
    chrome.runtime.getContexts.mockResolvedValue([
      { documentUrl: 'chrome-extension://xomoni/other.html', tabId: 4, windowId: 1 },
      { documentUrl: `${DASHBOARD}#/jobs`, tabId: 5, windowId: 2 },
    ]);

    on.action!();

    await vi.waitFor(() => expect(chrome.windows.update).toHaveBeenCalledWith(2, { focused: true }));
    expect(chrome.tabs.update).toHaveBeenCalledWith(5, { active: true });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('does not focus a window Chrome gives no id for', async () => {
    chrome.runtime.getContexts.mockResolvedValue([{ documentUrl: DASHBOARD, tabId: 5, windowId: -1 }]);

    on.action!();

    await vi.waitFor(() => expect(chrome.tabs.update).toHaveBeenCalledWith(5, { active: true }));
    await settle();
    expect(chrome.windows.update).not.toHaveBeenCalled();
  });

  it('opens a new dashboard when the one found is not in a tab', async () => {
    chrome.runtime.getContexts.mockResolvedValue([{ documentUrl: DASHBOARD, tabId: -1, windowId: -1 }]);

    on.action!();

    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: DASHBOARD }));
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it('opens the dashboard on install, not on an update', async () => {
    on.installed!({ reason: 'update' });
    await settle();
    expect(chrome.tabs.create).not.toHaveBeenCalled();

    on.installed!({ reason: 'install' });
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: DASHBOARD }));
  });
});

describe('service worker: notification clicks', () => {
  it('opens the dashboard from a “job ended” notification and dismisses it', async () => {
    on.notification!(FINISHED_ID);

    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: DASHBOARD }));
    expect(chrome.notifications.clear).toHaveBeenCalledWith(FINISHED_ID);
    expect(chrome.storage.session.get).not.toHaveBeenCalled();
  });

  it('brings up the worker window from an “X needs you” notification', async () => {
    chrome.storage.session.get.mockResolvedValue({ workerTab: WORKER.id });

    on.notification!(ATTENTION_ID);

    await vi.waitFor(() => expect(chrome.windows.update).toHaveBeenCalledWith(WORKER.windowId, { focused: true }));
    expect(chrome.notifications.clear).toHaveBeenCalledWith(ATTENTION_ID);
    expect(chrome.storage.session.get).toHaveBeenCalledWith('workerTab');
    expect(chrome.tabs.update).toHaveBeenCalledWith(WORKER.id, { active: true });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('restores a minimized worker window', async () => {
    chrome.storage.session.get.mockResolvedValue({ workerTab: WORKER.id });
    chrome.windows.get.mockResolvedValue({ id: WORKER.windowId, state: 'minimized' });

    on.notification!(ATTENTION_ID);

    await vi.waitFor(() =>
      expect(chrome.windows.update).toHaveBeenCalledWith(WORKER.windowId, { focused: true, state: 'normal' }),
    );
  });

  it('opens the dashboard when no worker window is known', async () => {
    on.notification!(ATTENTION_ID);

    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: DASHBOARD }));
    expect(chrome.tabs.get).not.toHaveBeenCalled();
  });

  it('opens the dashboard when the worker window was closed', async () => {
    chrome.storage.session.get.mockResolvedValue({ workerTab: WORKER.id });
    chrome.tabs.get.mockRejectedValue(new Error('No tab with id: 7'));

    on.notification!(ATTENTION_ID);

    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: DASHBOARD }));
  });
});

describe('service worker: observations from x.com tabs', () => {
  /** Xomoni's own content script, in the top frame of an x.com tab. */
  const FROM_TAB: Sender = { id: EXTENSION_ID, origin: 'https://x.com', frameId: 0, tab: { id: WORKER.id } };
  const draft: ItemDraft = {
    kind: 'post',
    id: '111',
    targetId: '111',
    createdAt: Date.UTC(2020, 0, 1),
    likedAt: null,
    text: 'hello',
    author: 'me',
    inReplyToId: null,
    selfReply: false,
    likes: 1,
    reposts: 0,
    replies: 0,
  };
  const OBS: RateObservation = {
    key: `${X_ME}:DeleteTweet`,
    accountId: X_ME,
    op: 'DeleteTweet',
    limit: 50,
    remaining: 3,
    reset: 2_000,
    status: 200,
    at: 1_000,
  };
  const ingest = (handle: string | null): RuntimeMessage => ({
    type: 'ingest',
    accountId: X_ME,
    handle,
    op: 'UserTweets',
    drafts: [draft],
    observedAt: 1_000,
  });

  it.each<[string, Sender]>([
    ['a sender without a tab', {}],
    [
      'a page of the extension itself',
      { id: EXTENSION_ID, origin: 'chrome-extension://xomoni', frameId: 0, tab: { id: 2 } },
    ],
    ['another extension', { ...FROM_TAB, id: 'someone-else' }],
    ['a frame inside the x.com page', { ...FROM_TAB, frameId: 3 }],
    ['a tab on another site', { ...FROM_TAB, origin: 'https://x.com.example.net' }],
    ['a sender without an origin or URL', { id: EXTENSION_ID, frameId: 0, tab: { id: 2 } }],
  ])('ignores a message from %s (#145)', async (_, sender) => {
    expect(on.message!(ingest('me'), sender)).toBeUndefined();
    await settle();
    expect(await db.items.count()).toBe(0);
    expect(await db.accounts.count()).toBe(0);
  });

  it('hears the content script by its URL when Chrome gives no origin', async () => {
    on.message!(ingest('me'), { id: EXTENSION_ID, url: 'https://x.com/me', frameId: 0, tab: { id: 2 } });

    await vi.waitFor(async () => expect(await kvGet('activeAccount', null)).toBe(X_ME));
  });

  it.each<[string, unknown]>([
    ['an unknown type', { type: 'wipe', accountId: X_ME }],
    ['an account id that isn’t an X id', { ...ingest('me'), accountId: 'acct-me' }],
    ['an operation Xomoni doesn’t read', { ...ingest('me'), op: 'DeleteTweet' }],
    [
      'more than 200 posts',
      { ...ingest('me'), drafts: Array.from({ length: 201 }, (_, i) => ({ ...draft, id: `${i + 1}` })) },
    ],
    ['a post whose id isn’t an X id', { ...ingest('me'), drafts: [{ ...draft, id: '1/../2' }] }],
    ['a post text longer than X allows', { ...ingest('me'), drafts: [{ ...draft, text: 'x'.repeat(30_001) }] }],
  ])('stores nothing from a message with %s (#145)', async (_, message) => {
    on.message!(message as RuntimeMessage, FROM_TAB);
    await settle();
    expect(await db.items.count()).toBe(0);
    expect(await db.accounts.count()).toBe(0);
    expect(await kvGet('activeAccount', null)).toBeNull();
  });

  it('stores only the fields Xomoni knows, never extra ones a page added', async () => {
    const message = { ...ingest('me'), drafts: [{ ...draft, status: 'gone', lastJobId: 'job-1' }] };
    on.message!(message, FROM_TAB);

    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
    expect(await db.items.get(itemKey(X_ME, 'post', '111'))).toMatchObject({ status: 'present', lastJobId: null });
  });

  it('believes a rate-limit reset at most a day ahead (#145)', async () => {
    const now = Date.now();
    const yearAhead = now + 365 * 86_400_000;
    on.message!({ type: 'rate', obs: { ...OBS, reset: yearAhead, at: now } }, FROM_TAB);

    await vi.waitFor(async () => expect(await db.limits.get(OBS.key)).toBeDefined());
    const stored = await db.limits.get(OBS.key);
    expect(stored!.reset).toBeLessThanOrEqual(Date.now() + 86_400_000);
    expect(stored!.reset).toBeGreaterThan(now + 86_400_000 - 60_000);
  });

  it('stores scanned posts, a new account and the active account', async () => {
    on.message!(ingest('me'), FROM_TAB);

    await vi.waitFor(async () => expect(await kvGet('activeAccount', null)).toBe(X_ME));
    expect(await db.items.get(itemKey(X_ME, 'post', '111'))).toMatchObject({
      accountId: X_ME,
      sources: ['scan'],
      status: 'present',
      seenAt: 1_000,
      text: 'hello',
    });
    expect(await db.accounts.get(X_ME)).toMatchObject({ id: X_ME, handle: 'me' });
  });

  it('creates an account without a handle when the page showed none', async () => {
    on.message!(ingest(null), FROM_TAB);

    await vi.waitFor(async () => expect(await kvGet('activeAccount', null)).toBe(X_ME));
    expect(await db.accounts.get(X_ME)).toMatchObject({ id: X_ME, handle: '' });
  });

  it('leaves a known account alone unless its handle changed', async () => {
    await db.accounts.put(account({ id: X_ME, updatedAt: 5 }));

    on.message!(ingest('me'), FROM_TAB);
    await vi.waitFor(async () => expect(await kvGet('activeAccount', null)).toBe(X_ME));
    expect(await db.accounts.get(X_ME)).toMatchObject({ handle: 'me', updatedAt: 5 });

    await db.kv.clear();
    on.message!(ingest(null), FROM_TAB);
    await vi.waitFor(async () => expect(await kvGet('activeAccount', null)).toBe(X_ME));
    expect(await db.accounts.get(X_ME)).toMatchObject({ handle: 'me', updatedAt: 5 });

    await db.kv.clear();
    on.message!(ingest('me_renamed'), FROM_TAB);
    await vi.waitFor(async () => expect(await kvGet('activeAccount', null)).toBe(X_ME));
    expect(await db.accounts.get(X_ME)).toMatchObject({ handle: 'me_renamed', name: 'Me', postsCount: 1200 });
  });

  it('stores the viewer’s profile with when it was read', async () => {
    on.message!(
      {
        type: 'profile',
        profile: {
          id: X_ME,
          handle: 'me',
          name: 'Me',
          avatar: 'https://pbs.twimg.com/me.jpg',
          postsCount: 42,
          likesCount: 7,
          followers: 3,
          following: 4,
          createdAt: Date.UTC(2015, 0, 1),
          verified: null,
        },
      },
      FROM_TAB,
    );

    await vi.waitFor(async () => expect(await db.accounts.get(X_ME)).toMatchObject({ postsCount: 42, likesCount: 7 }));
    expect((await db.accounts.get(X_ME))?.profileAt).toEqual(expect.any(Number));
  });

  it('stores X’s rate-limit observation', async () => {
    on.message!({ type: 'rate', obs: OBS }, FROM_TAB);

    await vi.waitFor(async () => expect(await db.limits.get(OBS.key)).toEqual(OBS));
  });

  it('logs an observation it could not store, and keeps working', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new Error('QuotaExceededError');
    const put = vi.spyOn(db.limits, 'put').mockRejectedValueOnce(failure);

    on.message!({ type: 'rate', obs: { ...OBS, op: 'FavoriteTweet', key: `${X_ME}:FavoriteTweet` } }, FROM_TAB);

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[xomoni] failed to store observation', failure));
    warn.mockRestore();
    put.mockRestore();

    on.message!(ingest('me'), FROM_TAB);
    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
  });
});
