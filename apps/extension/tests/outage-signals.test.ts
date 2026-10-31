import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCapture, lastTimelineStatus } from '../src/content/net';
import type * as Timers from '../src/engine/timers';
import { NotReady, PageError, WorkerTab } from '../src/engine/worker-tab';

// The real sleep runs on a Web Worker, which tests don't have.
vi.mock('../src/engine/timers', async (importOriginal) => ({
  ...(await importOriginal<typeof Timers>()),
  sleep: async () => {},
}));

const TAB = 7;
const page = { bootId: 'boot-2', url: 'https://x.com/home' };

/** A stub of the Chrome APIs the worker tab uses, with one worker tab whose id is in session storage. */
function stubChrome(tab: { discarded: boolean }) {
  const tabs = {
    get: vi.fn(async () => ({ id: TAB, ...tab })),
    reload: vi.fn(async () => {
      tab.discarded = false;
    }),
    update: vi.fn(async () => ({})),
    sendMessage: vi.fn(async (): Promise<unknown> => {
      if (tab.discarded) throw new Error('Could not establish connection');
      return page;
    }),
  };
  vi.stubGlobal('chrome', {
    tabs,
    storage: { session: { get: vi.fn(async () => ({ workerTab: TAB })), set: vi.fn(), remove: vi.fn() } },
  });
  return tabs;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorkerTab: discarded tabs and slow pages (PLAYBOOK F5, #60)', () => {
  it('asks Chrome not to unload the worker tab', async () => {
    const tabs = stubChrome({ discarded: false });
    await new WorkerTab().keepLoaded();
    expect(tabs.update).toHaveBeenCalledWith(TAB, { autoDiscardable: false });
  });

  it('reloads a tab Chrome unloaded at once, then continues', async () => {
    const tabs = stubChrome({ discarded: true });
    const info = await new WorkerTab().waitReady(new AbortController().signal);
    expect(tabs.reload).toHaveBeenCalledOnce();
    expect(info).toEqual(page);
  });

  it('throws NotReady, which the runner waits out, when the page never answers', async () => {
    const tabs = stubChrome({ discarded: false });
    tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection'));
    await expect(new WorkerTab().waitReady(new AbortController().signal, undefined, 20)).rejects.toBeInstanceOf(
      NotReady,
    );
  });

  it('reports an error from the content script as a PageError, which pauses the job', async () => {
    const tabs = stubChrome({ discarded: false });
    tabs.sendMessage.mockResolvedValue({ error: 'boom' });
    await expect(new WorkerTab().send({ cmd: 'visible' })).rejects.toThrow(PageError);
  });
});

describe('lastTimelineStatus: the page’s last timeline answer (PLAYBOOK F6)', () => {
  const capture = (op: string, status: number) =>
    handleCapture({
      op,
      url: `https://x.com/i/api/graphql/abc/${op}?variables=%7B%7D`,
      status,
      reqBody: null,
      headers: {},
      body: '',
    });

  beforeEach(() => {
    vi.stubGlobal('document', { cookie: '' });
  });

  it('records the status of timeline requests, including failed ones', () => {
    capture('SearchTimeline', 503);
    expect(lastTimelineStatus()).toBe(503);
    capture('TweetDetail', 0);
    expect(lastTimelineStatus()).toBe(0);
  });

  it('ignores writes and other requests', () => {
    capture('UserTweets', 200);
    capture('DeleteTweet', 500);
    capture('UserByScreenName', 503);
    expect(lastTimelineStatus()).toBe(200);
  });
});
