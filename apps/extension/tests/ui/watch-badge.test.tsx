// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type * as DexieReactHooks from 'dexie-react-hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveWatchResult, setReadyTab, upsertAccount } from '../../src/shared/db';
import { useWatchBadge } from '../../src/ui/watch-badge';
import { resetDb } from '../support/fixtures';

// The toolbar badge's hook in the dashboard's shell (#391): it follows Watch's checks, and its live query is one Dexie
// can follow, so the dashboard's other live queries keep following the database (S199-18).

vi.mock('dexie-react-hooks', async (importOriginal) => {
  const real = await importOriginal<typeof DexieReactHooks>();
  return { ...real, useLiveQuery: vi.fn(real.useLiveQuery) };
});

const ACCOUNT = '9000000000000000777';
const DAY = 86_400_000;

let action: {
  setBadgeText: ReturnType<typeof vi.fn>;
  setBadgeBackgroundColor: ReturnType<typeof vi.fn>;
  setTitle: ReturnType<typeof vi.fn>;
};

beforeEach(async () => {
  await resetDb();
  action = {
    setBadgeText: vi.fn(() => Promise.resolve()),
    setBadgeBackgroundColor: vi.fn(() => Promise.resolve()),
    setTitle: vi.fn(() => Promise.resolve()),
  };
  vi.stubGlobal('chrome', { action, runtime: { getManifest: () => ({ action: { default_title: 'Xomoni' } }) } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(useLiveQuery).mockClear();
});

describe('useWatchBadge (#391)', () => {
  it('puts the unseen posts from new accounts on the toolbar as a check comes in', async () => {
    await upsertAccount({ id: ACCOUNT, handle: 'me' });
    await setReadyTab(ACCOUNT, 'mentions', true);
    renderHook(() => {
      useWatchBadge(ACCOUNT);
    });
    await waitFor(() => {
      expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    });

    const now = Date.now();
    await saveWatchResult(ACCOUNT, 'mentions', {
      query: '@me -from:me',
      checkedAt: now,
      posts: [{ id: '1', handle: 'new_one', name: '', text: 'hi', time: now, accountCreatedAt: now - DAY }],
      error: '',
    });
    await waitFor(() => {
      expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
    });
  });

  it('reads through an async querier, the only kind whose reads Dexie follows across awaits', () => {
    renderHook(() => {
      useWatchBadge(null);
    });
    const querier = vi.mocked(useLiveQuery).mock.calls[0]?.[0] as unknown as Record<symbol, unknown> | undefined;
    expect(querier?.[Symbol.toStringTag]).toBe('AsyncFunction');
  });
});
