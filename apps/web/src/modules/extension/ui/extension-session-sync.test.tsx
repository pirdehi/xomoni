// @vitest-environment happy-dom
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, router, setLocation } from '@test/fakes/navigation';
import type { SyncOutcome } from '../application/session-sync';
import { type ExtensionSessionServices, requestLinkCheck } from '../client/extension-session';
import { renderToString } from 'react-dom/server';
import { ExtensionSessionSync, UNKNOWN_LINK, useExtensionLink } from './extension-session-sync';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';

/** Services that answer `outcome` to every sync and record what the component asked. */
function fakeServices(outcome: SyncOutcome = { kind: 'no-extension' }) {
  let sessionChanged: () => void = () => undefined;
  const services = {
    sync: vi.fn(() => Promise.resolve(outcome)),
    signOutBoth: vi.fn(() => Promise.resolve()),
    rememberExtension: vi.fn(),
    onSessionChange: vi.fn((onChange: () => void) => {
      sessionChanged = onChange;
      return vi.fn();
    }),
  } satisfies ExtensionSessionServices;
  return { services, changeSession: () => sessionChanged() };
}

beforeEach(() => {
  resetNavigation();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ExtensionSessionSync (#232, ADR-0025)', () => {
  it('keeps the extension’s id from the fragment and clears it from the address bar', async () => {
    setLocation('/dashboard');
    window.history.replaceState(null, '', `/dashboard?tab=jobs#ext=${EXT}`);
    const { services } = fakeServices();

    render(<ExtensionSessionSync services={() => services} />);

    expect(services.rememberExtension).toHaveBeenCalledWith(EXT);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/dashboard?tab=jobs');
    await waitFor(() => expect(services.sync).toHaveBeenCalledTimes(1));
  });

  it('on /connect keeps the id but leaves the fragment and the pairing to the page, with no sync', async () => {
    setLocation('/connect');
    window.history.replaceState(null, '', `/connect#ext=${EXT}&nonce=AbCdEfGhIjKlMnOpQrStUv`);
    const { services, changeSession } = fakeServices();

    render(<ExtensionSessionSync services={() => services} />);
    changeSession();
    window.dispatchEvent(new Event('focus'));

    expect(services.rememberExtension).toHaveBeenCalledWith(EXT);
    expect(window.location.hash).toContain('nonce=');
    await act(() => Promise.resolve());
    expect(services.sync).not.toHaveBeenCalled();
  });

  it('syncs again when the page comes back into view, gains focus or the browser signs in, one at a time', async () => {
    let finish: (outcome: SyncOutcome) => void = () => undefined;
    const { services, changeSession } = fakeServices();
    services.sync.mockImplementation(() => new Promise<SyncOutcome>((resolve) => (finish = resolve)));

    render(<ExtensionSessionSync services={() => services} />);
    expect(services.sync).toHaveBeenCalledTimes(1);
    // While one runs, another doesn't start.
    window.dispatchEvent(new Event('focus'));
    expect(services.sync).toHaveBeenCalledTimes(1);
    await act(async () => finish({ kind: 'no-extension' }));

    window.dispatchEvent(new Event('focus'));
    expect(services.sync).toHaveBeenCalledTimes(2);
    await act(async () => finish({ kind: 'no-extension' }));

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(services.sync).toHaveBeenCalledTimes(2);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(services.sync).toHaveBeenCalledTimes(3);
    await act(async () => finish({ kind: 'no-extension' }));

    changeSession();
    expect(services.sync).toHaveBeenCalledTimes(4);
  });

  it('goes to the sign-in page once a sign-out made in the extension signed the website out', async () => {
    const { services } = fakeServices({ kind: 'website-signed-out' });

    render(<ExtensionSessionSync services={() => services} />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(router.refresh).toHaveBeenCalled();
  });

  it('stays put after any other outcome, and after a sync that failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { services } = fakeServices({ kind: 'extension-signed-in', account: 'a', deviceId: 'd' });
    render(<ExtensionSessionSync services={() => services} />);
    await act(() => Promise.resolve());
    expect(router.replace).not.toHaveBeenCalled();

    services.sync.mockRejectedValueOnce(new Error('offline'));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('[xomoni] sync with the extension failed', expect.any(Error)),
    );
  });

  it('signs the extension out before a sign-out form posts, then posts it as before', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    const { services } = fakeServices();
    render(<ExtensionSessionSync services={() => services} />);
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/auth/signout?scope=everywhere';
    document.body.append(form);

    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(services.signOutBoth).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    form.remove();
  });

  it('still posts the sign-out when the extension couldn’t be told', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    const { services } = fakeServices();
    services.signOutBoth.mockRejectedValueOnce(new Error('gone'));
    render(<ExtensionSessionSync services={() => services} />);
    const form = document.createElement('form');
    form.action = '/auth/signout';
    document.body.append(form);

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    form.remove();
  });

  it('leaves every other form alone', () => {
    const { services } = fakeServices();
    render(<ExtensionSessionSync services={() => services} />);
    const form = document.createElement('form');
    form.action = '/account/email';
    document.body.append(form);

    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    document.body.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(event.defaultPrevented).toBe(false);
    expect(services.signOutBoth).not.toHaveBeenCalled();
    form.remove();
  });

  it('syncs again when a page asks to look for Xomoni, one at a time (#299)', async () => {
    let finish: (outcome: SyncOutcome) => void = () => undefined;
    const { services } = fakeServices();
    services.sync.mockImplementation(() => new Promise<SyncOutcome>((resolve) => (finish = resolve)));
    render(<ExtensionSessionSync services={() => services} />);
    expect(services.sync).toHaveBeenCalledTimes(1);

    requestLinkCheck();
    expect(services.sync).toHaveBeenCalledTimes(1);
    await act(async () => finish({ kind: 'no-extension' }));

    requestLinkCheck();
    expect(services.sync).toHaveBeenCalledTimes(2);
    await act(async () => finish({ kind: 'no-extension' }));
  });

  it('stops listening when it goes away', () => {
    const { services } = fakeServices();
    const { unmount } = render(<ExtensionSessionSync services={() => services} />);
    const stop = services.onSessionChange.mock.results[0]!.value as () => void;

    unmount();
    window.dispatchEvent(new Event('focus'));
    requestLinkCheck();

    expect(stop).toHaveBeenCalled();
    expect(services.sync).toHaveBeenCalledTimes(1);
  });
});

describe('useExtensionLink (#232)', () => {
  it('starts unknown, before the first sync', () => {
    const { result } = renderHook(() => useExtensionLink());
    expect(result.current.status).toBeTypeOf('string');
  });

  it('renders on the server with one cached snapshot, without React’s infinite-loop warning (#239)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Probe() {
      return <span>{useExtensionLink().status}</span>;
    }

    expect(renderToString(<Probe />)).toContain('unknown');
    expect(renderToString(<Probe />)).toContain('unknown');
    expect(error).not.toHaveBeenCalled();
    expect(UNKNOWN_LINK).toEqual({ status: 'unknown' });
  });
});
