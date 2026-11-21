// @vitest-environment happy-dom
import { Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, useFluent } from '@fluentui/react-components';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { XOMONI_BRAND_AA } from '@xomoni/fluent-theme';
import { isValidElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, serverInsertedHTML } from '@test/fakes/navigation';
import { DARK_MEDIA_CSS, SiteFluentProvider, siteDark, siteLight, usePrefersDark } from './fluent-provider';

/** A `matchMedia` whose dark-mode answer the test sets, with listeners it can fire. */
function stubSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return dark;
    },
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }));
  return {
    listeners,
    change(next: boolean) {
      dark = next;
      listeners.forEach((l) => l());
    },
  };
}

/** Reads whether it is inside Fluent's provider. */
function Probe() {
  const { targetDocument } = useFluent();
  return <span>{targetDocument ? 'inside Fluent' : 'outside'}</span>;
}

beforeEach(() => {
  resetNavigation();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Fluent UI on xomoni.com (ADR-0019)', () => {
  it('uses Xomoni’s shared themes on the site’s font', () => {
    // Xomoni's blue, a shade deeper for white text at WCAG AA (#342).
    expect(siteLight.colorBrandBackground).toBe(XOMONI_BRAND_AA.button);
    expect(siteDark.colorNeutralBackground1).toBe('#1a1a19');
    expect(siteLight.fontFamilyBase).toMatch(/^var\(--font-geist-sans\)/);
  });

  it('puts the dark theme’s variables under the system’s dark mode, outranking the light ones', () => {
    expect(DARK_MEDIA_CSS).toMatch(/^@media \(prefers-color-scheme: dark\) \{ \.xomoni-theme\.xomoni-theme \{/);
    expect(DARK_MEDIA_CSS).toContain('--colorNeutralBackground1: #1a1a19;');
  });

  it('wraps the page in the provider, out of the layout, with the dark-mode rules in the page', () => {
    stubSystem(false);
    const { container } = render(
      <SiteFluentProvider>
        <Probe />
      </SiteFluentProvider>,
    );
    expect(screen.getByText('inside Fluent')).toBeInTheDocument();
    expect(container.querySelector('style')?.textContent).toBe(DARK_MEDIA_CSS);
    const root = container.querySelector('.xomoni-theme');
    expect(root).toHaveStyle({ display: 'contents' });
  });
});

describe('server rendering', () => {
  it('inserts Griffel’s styles into the page once, not on every streamed chunk', () => {
    stubSystem(false);
    render(
      <SiteFluentProvider>
        <Probe />
      </SiteFluentProvider>,
    );
    const [first] = serverInsertedHTML();
    expect(isValidElement(first)).toBe(true);
    // Later chunks of the same render insert nothing more.
    expect(serverInsertedHTML().every((html) => html === null)).toBe(true);
  });
});

describe('dialogs (#315)', () => {
  /**
   * A page with a dialog over it that uses nothing else of Fluent's focus manager. The dialog goes without closing
   * first, as when a link in it leads to another page.
   */
  function Page({ dialog }: { dialog: boolean }) {
    return (
      <main>
        <h1>Install Xomoni</h1>
        {dialog && (
          <Dialog open>
            <DialogSurface>
              <DialogBody>
                <DialogTitle>Xomoni isn’t in this browser</DialogTitle>
                <DialogContent>
                  <a href="/install">Install Xomoni</a>
                </DialogContent>
              </DialogBody>
            </DialogSurface>
          </Dialog>
        )}
      </main>
    );
  }

  it('shows the page again once a dialog that hid it is gone', async () => {
    stubSystem(false);
    const { rerender } = render(
      <SiteFluentProvider>
        <Page dialog />
      </SiteFluentProvider>,
    );
    const heading = screen.getByRole('heading', { level: 1, hidden: true });
    // A quarter second after it opens, Fluent hides the page behind the dialog from assistive technology.
    await waitFor(() => expect(heading.closest('[aria-hidden="true"]')).not.toBeNull());

    rerender(
      <SiteFluentProvider>
        <Page dialog={false} />
      </SiteFluentProvider>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Install Xomoni' })).toBe(heading);
    expect(heading.closest('[aria-hidden="true"], [inert]')).toBeNull();
  });
});

describe('usePrefersDark', () => {
  it('follows the system’s dark mode and stops listening when unmounted', () => {
    const system = stubSystem(true);
    const { result, unmount } = renderHook(() => usePrefersDark());
    expect(result.current).toBe(true);
    act(() => system.change(false));
    expect(result.current).toBe(false);
    unmount();
    expect(system.listeners.size).toBe(0);
  });
});
