// @vitest-environment happy-dom
// The checklist ticking for a copy of Xomoni found by a store's fixed id, with no `#ext=` in any URL (#302): the real
// sync (`ExtensionSessionSync`) and composition roots, a stubbed `chrome.runtime`, and the stores' ids as they will be
// once written in `@xomoni/bridge`.
import { cleanup, render, screen, within } from '@testing-library/react';
import type * as Bridge from '@xomoni/bridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, setLocation } from '@test/fakes/navigation';
import { ExtensionSessionSync } from './extension-session-sync';
import { GettingStarted } from './getting-started';

const { CHROME } = vi.hoisted(() => ({ CHROME: 'ponmlkjihgfedcbaponmlkjihgfedcba' }));

vi.mock('@xomoni/bridge', async (importOriginal) => {
  const bridge = await importOriginal<typeof Bridge>();
  const ids = { chrome: CHROME, edge: null };
  return { ...bridge, STORE_EXTENSION_IDS: ids, storeExtensionIds: () => bridge.storeExtensionIds(ids) };
});
vi.mock('@/shared/supabase/browser-session', () => ({
  watchSessionEmail: (onChange: (email: string | null) => void) => {
    onChange(null);
    return () => undefined;
  },
}));

/** Waits until the checklist's first step reads `text`, as a person reads it. */
const installStepReads = (text: string) =>
  vi.waitFor(() =>
    expect(
      within(screen.getByRole('region', { name: 'Getting started' })).getAllByRole('listitem')[0]?.textContent,
    ).toBe(text),
  );

beforeEach(() => {
  resetNavigation();
  setLocation('/welcome');
  window.history.replaceState(null, '', '/welcome');
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('the getting-started checklist with a fixed id (#302)', () => {
  it('ticks the install step once Xomoni answers at the Chrome Web Store’s id, with no #ext= in the URL', async () => {
    const sendMessage = vi.fn((id: string, _message: unknown, callback: (answer: unknown) => void) =>
      callback(
        id === CHROME
          ? { ok: true, state: { version: '0.5.0', connection: null, signedOutAt: null, leftAt: 0 } }
          : undefined,
      ),
    );
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    render(
      <>
        <ExtensionSessionSync />
        <GettingStarted next="/welcome" />
      </>,
    );

    await installStepReads('Install Xomoni in this browser: done');
    expect(sendMessage).toHaveBeenCalledWith(CHROME, { type: 'xomoni-hello' }, expect.any(Function));
    // Only a hello went out: the page asks how Xomoni stands and starts nothing (ADR-0006).
    expect(new Set(sendMessage.mock.calls.map(([, message]) => message))).toEqual(new Set([{ type: 'xomoni-hello' }]));
  });

  it('still asks to install in a browser where no extension can be reached', async () => {
    vi.stubGlobal('chrome', undefined);

    render(
      <>
        <ExtensionSessionSync />
        <GettingStarted next="/welcome" />
      </>,
    );

    await installStepReads('Install Xomoni in this browser');
    expect(screen.getByRole('link', { name: 'Install Xomoni' })).toHaveAttribute('href', '/install');
  });
});
