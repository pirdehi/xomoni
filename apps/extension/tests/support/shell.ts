import { vi } from 'vitest';
import { type RunnerState, runner } from '../../src/engine/runner';
import type { PageInfo } from '../../src/shared/messages';
import type { Item, ItemKind, ItemStatus, LogEntry } from '../../src/shared/types';
import { WORKER_TAB, type stubChrome } from './chrome';
import { ME } from './fixtures';

type ChromeStub = ReturnType<typeof stubChrome>;

/** The content script's `ping` reply for a signed-in, visible x.com page of the account `ME`. */
export function pageInfo(over: Partial<PageInfo> = {}): PageInfo {
  return {
    bootId: 'boot-1',
    url: 'https://x.com/home',
    path: '/home',
    viewerId: ME,
    handle: 'me',
    loggedIn: true,
    locked: false,
    challenge: false,
    restriction: null,
    obstructed: false,
    lang: 'en',
    hidden: false,
    ...over,
  };
}

/**
 * Makes the stubbed `chrome` report an open worker tab (id 7, as `worker-tab.ts` finds it through
 * `chrome.storage.session`) whose content script answers `ping` with `info`; with `null` the tab is open but
 * nothing answers, as while it loads.
 */
export function openWorker(chrome: ChromeStub, info: PageInfo | null) {
  chrome.storage.session.get.mockResolvedValue({ workerTab: WORKER_TAB.id });
  chrome.tabs.get.mockResolvedValue(WORKER_TAB);
  if (info) chrome.tabs.sendMessage.mockResolvedValue(info);
  else chrome.tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection'));
}

/** A file the dashboard handed to the browser through `downloadFile`. */
export interface Download {
  name: string;
  type: string;
  text: () => Promise<string>;
}

/**
 * Captures the files the page saves (`downloadFile` in `format.ts`) instead of letting the DOM follow the
 * object URL. Spies are undone by `vi.restoreAllMocks()`.
 */
export function captureDownloads(): Download[] {
  const blobs = new Map<string, Blob>();
  const downloads: Download[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((obj) => {
    const url = `blob:test-${blobs.size + 1}`;
    blobs.set(url, obj as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const blob = blobs.get(this.getAttribute('href') ?? '');
    if (!blob) throw new Error(`No blob for ${this.getAttribute('href') ?? '(no href)'}`);
    downloads.push({ name: this.download, type: blob.type, text: () => blob.text() });
  });
  return downloads;
}

/**
 * Replaces the runner singleton's state with one the test controls: `set` changes it and notifies the
 * dashboard, as the runner does while a job runs. Spies are undone by `vi.restoreAllMocks()`.
 */
export function fakeRunner(initial: Partial<RunnerState> = {}) {
  let state: RunnerState = { ...runner.getState(), ...initial };
  const listeners = new Set<() => void>();
  vi.spyOn(runner, 'subscribe').mockImplementation((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  vi.spyOn(runner, 'getState').mockImplementation(() => state);
  return {
    set(patch: Partial<RunnerState>) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
  };
}

let itemSeq = 0;

/** An inventory item of account `ME`, as the scans store it. */
export function item(kind: ItemKind, status: ItemStatus, over: Partial<Item> = {}): Item {
  const id = String(++itemSeq);
  return {
    key: `${ME}:${kind}:${id}`,
    accountId: ME,
    kind,
    id,
    targetId: id,
    createdAt: Date.UTC(2019, 5, 1),
    likedAt: null,
    text: `post ${id}`,
    author: 'me',
    inReplyToId: null,
    selfReply: false,
    likes: 0,
    reposts: 0,
    replies: 0,
    sources: ['scan'],
    status,
    seenAt: 0,
    statusAt: 0,
    lastJobId: null,
    ...over,
  };
}

/** An activity log entry of account `ME`; `ts` defaults to now. */
export function logEntry(over: Partial<LogEntry> = {}): LogEntry {
  return {
    ts: Date.now(),
    accountId: ME,
    jobId: null,
    level: 'info',
    action: 'system',
    targetId: null,
    outcome: null,
    message: 'Something happened',
    ...over,
  };
}
