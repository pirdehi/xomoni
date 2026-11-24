// @vitest-environment happy-dom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GITHUB_URL, ISSUES_URL, RELEASES_URL, SECURITY_URL } from '@/shared/config/site';
import { BillingPagesProvider } from './billing-pages';
import { GithubMark, Logo, SiteFooter, SiteHeader } from './site-chrome';

// A visitor: the session cookie names no one.
vi.mock('@/shared/supabase/browser-session', () => ({
  watchSessionEmail: (onChange: (email: string | null) => void) => {
    onChange(null);
    return () => undefined;
  },
}));

/**
 * A `matchMedia` whose answer to the header's width (768 px and up) the test sets, with listeners it can fire, as a
 * screen turning; every other query, such as Fluent's reduced motion, doesn't match.
 */
function stubScreen(wide: boolean) {
  type Listener = (event: { matches: boolean }) => void;
  const listeners = new Set<Listener>();
  vi.stubGlobal('matchMedia', (query: string) =>
    query === '(min-width: 768px)'
      ? {
          get matches() {
            return wide;
          },
          addEventListener: (_: string, l: Listener) => listeners.add(l),
          removeEventListener: (_: string, l: Listener) => listeners.delete(l),
        }
      : { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined },
  );
  return {
    turn(next: boolean) {
      wide = next;
      act(() => listeners.forEach((l) => l({ matches: next })));
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Logo', () => {
  it('links home with the name as its text, the image being decorative', () => {
    render(<Logo />);

    const link = screen.getByRole('link', { name: 'Xomoni' });
    expect(link).toHaveAttribute('href', '/');
    // The logo image has an empty alt, so the link's accessible name is just the word.
    expect(within(link).getByRole('presentation')).toHaveAttribute('alt', '');
  });
});

describe('GithubMark', () => {
  it('is hidden from screen readers and sized like an icon, one em square', () => {
    const { container } = render(<GithubMark className="mark" />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '1em');
    expect(svg).toHaveAttribute('height', '1em');
    expect(svg).toHaveClass('mark');
  });
});

describe('SiteHeader', () => {
  it('shows a visitor the default navigation and a sign-in link', async () => {
    render(<SiteHeader />);
    await screen.findByRole('link', { name: 'Sign in' });

    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'Xomoni' })).toHaveAttribute('href', '/');
    expect(within(banner).getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/#how');
    expect(within(banner).getByRole('link', { name: 'Safety' })).toHaveAttribute('href', '/#safety');
    expect(within(banner).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/#privacy');
    expect(within(banner).getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', GITHUB_URL);
    expect(within(banner).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    // Sign-in is the one call to action; the section links are quiet.
    expect(within(banner).getByRole('link', { name: 'Sign in' })).toHaveAttribute('data-appearance', 'primary');
    expect(within(banner).getByRole('link', { name: 'Safety' })).toHaveAttribute('data-appearance', 'subtle');
    expect(within(banner).getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    // Install is always one click away, without outshining Sign in (#242).
    expect(within(banner).getByRole('link', { name: 'Install' })).toHaveAttribute('href', '/install');
    expect(within(banner).getByRole('link', { name: 'Install' })).toHaveAttribute('data-appearance', 'secondary');
  });

  it('folds the links into a menu on a phone, opened and closed with the keyboard (#242)', async () => {
    render(<SiteHeader />);
    const button = screen.getByRole('button', { name: 'Menu' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => [item.textContent, item.getAttribute('href')]),
    ).toEqual([
      ['How it works', '/#how'],
      ['Safety', '/#safety'],
      ['Privacy', '/#privacy'],
      ['Install', '/install'],
      ['GitHub', GITHUB_URL],
    ]);
    // It closes with Escape and gives focus back to the button; that focus moves into it is checked in a real
    // browser (e2e/install.spec.ts), as happy-dom doesn't run Fluent's focus management.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(button).toHaveFocus();
  });

  it('closes the menu once the screen is wide enough for the links, and only then (#345)', async () => {
    const screenSize = stubScreen(false);
    render(<SiteHeader />);
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await screen.findByRole('menu');

    // Still a phone's width, such as a phone made taller: the menu stays.
    screenSize.turn(false);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    // A phone turned on its side, 844 px wide: the button is hidden, so the menu goes with it.
    screenSize.turn(true);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    // Back to a phone's width, it stays closed until opened again.
    screenSize.turn(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('shows only the account corner on pages of the signed-in app', () => {
    render(<SiteHeader app />);

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'How it works' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'GitHub' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Install' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: 'Menu' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});

describe('SiteFooter', () => {
  it('credits the author, disclaims X, and links every page a visitor may look for (#242)', () => {
    render(<SiteFooter />);

    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent('Not affiliated with X Corp.');
    expect(footer).toHaveTextContent('MIT license');
    expect(within(footer).getByRole('link', { name: 'Omid Pirdehi' })).toHaveAttribute(
      'href',
      'https://github.com/pirdehi',
    );
    const nav = within(footer).getByRole('navigation', { name: 'Site' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Install', '/install'],
      ['What’s new', RELEASES_URL],
      ['Algorithm digest', '/algorithm'],
      ['Risks', '/risks'],
      ['Privacy', '/privacy'],
      ['Terms', '/terms'],
      ['Security', SECURITY_URL],
      ['Support', ISSUES_URL],
      ['GitHub', GITHUB_URL],
    ]);
  });

  it('lists the terms of sale and the refund policy only while the server shows them (#420)', () => {
    const { unmount } = render(
      <BillingPagesProvider on={false}>
        <SiteFooter />
      </BillingPagesProvider>,
    );
    const off = within(screen.getByRole('navigation', { name: 'Site' }));
    expect(off.queryByRole('link', { name: 'Terms of sale' })).not.toBeInTheDocument();
    expect(off.queryByRole('link', { name: 'Refunds' })).not.toBeInTheDocument();
    unmount();

    render(
      <BillingPagesProvider on>
        <SiteFooter />
      </BillingPagesProvider>,
    );
    const links = within(screen.getByRole('navigation', { name: 'Site' }))
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links.slice(3, 7)).toEqual([
      ['Privacy', '/privacy'],
      ['Terms', '/terms'],
      ['Terms of sale', '/terms-of-sale'],
      ['Refunds', '/refunds'],
    ]);
  });
});
