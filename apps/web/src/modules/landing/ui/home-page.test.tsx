// @vitest-environment happy-dom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GITHUB_URL, INSTALL_PAGE_URL, INSTALL_URL } from '@/shared/config/site';
import type * as StoreListingsConfig from '@/shared/config/store-listings';
import type { StoreListings } from '@/shared/config/store-listings';
import { PILLARS, PILLAR_TEXT, PLACES, STATUS_LABEL, isAvailable } from '../domain/footprint';
import {
  ALWAYS,
  FAQ,
  HERO_FACTS,
  LIMITS,
  NEVER,
  PRINCIPLES,
  RISK_LINE,
  STAYS,
  STEPS,
  SYNCS,
  placeIcon,
} from './content';
import { HomePage } from './home-page';

// The site's configured listings, as each test sets them: none, as in the code until the stores list Xomoni (#304).
const configured = vi.hoisted(() => {
  const state: { listings: StoreListings } = { listings: { chrome: null, edge: null } };
  return state;
});
vi.mock('@/shared/config/store-listings', async (importOriginal) => {
  const actual = await importOriginal<typeof StoreListingsConfig>();
  return {
    ...actual,
    get STORE_LISTINGS() {
      return configured.listings;
    },
  };
});

const CHROME_STORE = 'https://chromewebstore.google.com/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';
const EDGE_STORE = 'https://microsoftedge.microsoft.com/addons/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';
const EDGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

beforeEach(() => {
  configured.listings = { chrome: null, edge: null };
});
afterEach(() => {
  for (const name of ['userAgent', 'share']) Reflect.deleteProperty(window.navigator, name);
});

// A visitor: the header's account corner reads no session.
vi.mock('@/shared/supabase/browser-session', () => ({
  watchSessionEmail: (onChange: (email: string | null) => void) => {
    onChange(null);
    return () => undefined;
  },
}));

const region = (name: string | RegExp) => screen.getByRole('region', { name });
const texts = (items: HTMLElement[]) => items.map((item) => item.textContent);
const x = PLACES.find(isAvailable)!;
// `\s` matches the no-break spaces that keep each phrase of the title whole.
const PILLARS_HEADING = /^Find\sit, understand\sit, clean\sit\sup, protect\sit, shape\sit\.$/;

describe('HomePage', () => {
  it('opens with what Xomoni is, that it starts with X, the two calls to action and the facts at a glance', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Manage your digital footprint, starting with X.' }),
    ).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('Digital footprint manager');
    expect(main).toHaveTextContent('It works on X today; your email is next.');
    const [install] = within(main).getAllByRole('link', { name: 'Get the extension' });
    expect(install).toHaveAttribute('href', INSTALL_URL);
    expect(install).toHaveAttribute('data-appearance', 'primary');
    expect(within(main).getByRole('link', { name: 'Sign in to your dashboard' })).toHaveAttribute('href', '/login');
    expect(texts(within(screen.getByRole('list', { name: 'At a glance' })).getAllByRole('listitem'))).toEqual(
      HERO_FACTS,
    );
  });

  it('says near the top that acting on X carries a risk, and links the risks page', () => {
    render(<HomePage />);

    const risk = screen.getByRole('note', { name: 'The risk' });
    expect(risk).toHaveTextContent(RISK_LINE);
    expect(risk).toHaveTextContent('X’s rules forbid automating its website');
    expect(within(risk).getByRole('link', { name: 'Read the risks' })).toHaveAttribute('href', '/risks');
  });

  it('shows the dashboard in the visitor’s color scheme, light by default and dark on a dark system', () => {
    const { container } = render(<HomePage />);

    const image = screen.getByRole('img', { name: /^Xomoni’s Home for an X account: a paused job/ });
    expect(image).toHaveAttribute('src', expect.stringContaining('overview.png'));
    expect(image).toHaveAttribute('width', '1440');
    expect(image).toHaveAttribute('height', '1000');
    // Eager, so the hero image isn't held back; the <picture> means only the matching file is fetched.
    expect(image).toHaveAttribute('loading', 'eager');
    const dark = container.querySelector('picture > source:not([media*="max-width"])');
    expect(dark).toHaveAttribute('media', '(prefers-color-scheme: dark)');
    expect(dark?.getAttribute('srcset')).toContain('overview-dark.png');
  });

  it('shows a narrower part of the dashboard on a phone, where the whole one can’t be read, in both schemes (#243)', () => {
    const { container } = render(<HomePage />);

    const sources = [...container.querySelectorAll('picture > source')];
    // The first source that matches wins, so the phone's come before the computer's dark one.
    expect(sources.map((source) => source.getAttribute('media'))).toEqual([
      '(max-width: 639px) and (prefers-color-scheme: dark)',
      '(max-width: 639px)',
      '(prefers-color-scheme: dark)',
    ]);
    expect(sources[0]?.getAttribute('srcset')).toContain('overview-narrow-dark.png');
    expect(sources[1]?.getAttribute('srcset')).toContain('overview-narrow.png');
    for (const narrow of sources.slice(0, 2)) {
      expect(narrow).toHaveAttribute('width', '920');
      expect(narrow).toHaveAttribute('height', '1160');
    }
  });

  it('shows no platform’s logo: the dashboard is the page’s only picture, and no X glyph stands in for one', () => {
    const { container } = render(<HomePage />);

    const main = screen.getByRole('main');
    expect(within(main).getAllByRole('img')).toHaveLength(1);
    expect(main.querySelectorAll('img')).toHaveLength(1);
    expect(container.textContent).not.toContain('𝕏');
  });

  it('has the sections the header links to, by id, and the new ones', () => {
    render(<HomePage />);

    expect(region('A careful assistant in your browser, not a bot on a server.')).toHaveAttribute('id', 'how');
    expect(region('Under your oversight, within each platform’s limits.')).toHaveAttribute('id', 'safety');
    expect(region('Your posts never touch our servers.')).toHaveAttribute('id', 'privacy');
    expect(region(PILLARS_HEADING)).toHaveAttribute('id', 'what');
    expect(region('X today. Your email next. Then everywhere you are.')).toHaveAttribute('id', 'places');
  });

  it('keeps its headings in order, one h1 and no level skipped', () => {
    render(<HomePage />);

    const levels = within(screen.getByRole('main'))
      .getAllByRole('heading')
      .map((heading) => Number(heading.tagName.slice(1)));
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    levels.slice(1).forEach((level, i) => expect(level).toBeLessThanOrEqual(levels[i]! + 1));
  });

  it('names the five things Xomoni does, in order, each with what it is on X today', () => {
    render(<HomePage />);

    const pillars = within(region(PILLARS_HEADING)).getByRole('list', {
      name: 'The five things Xomoni does',
    });
    const items = within(pillars).getAllByRole('listitem');
    expect(items).toHaveLength(PILLARS.length);
    PILLARS.forEach((pillar, i) => {
      const item = items[i]!;
      expect(within(item).getByRole('heading', { level: 3, name: PILLAR_TEXT[pillar].name })).toBeInTheDocument();
      expect(item).toHaveTextContent(PILLAR_TEXT[pillar].summary);
      expect(item).toHaveTextContent(`On X today ${x.does[pillar]}`);
      // Only X: no line for a place that is only planned.
      expect(item).not.toHaveTextContent(/email/i);
    });
  });

  it('shows the places in order with where each stands, says email isn’t available yet, and isn’t X’s', () => {
    render(<HomePage />);

    const places = region('X today. Your email next. Then everywhere you are.');
    const cards = within(within(places).getByRole('list', { name: 'Places' })).getAllByRole('listitem');
    expect(cards.map((card) => within(card).getByRole('heading', { level: 3 }).textContent)).toEqual(
      PLACES.map((place) => place.name),
    );
    PLACES.forEach((place, i) => {
      expect(cards[i]).toHaveAttribute('data-status', place.status);
      expect(cards[i]).toHaveTextContent(STATUS_LABEL[place.status]);
      expect(cards[i]).toHaveTextContent(place.summary);
    });
    expect(cards[0]).toHaveTextContent('Today');
    expect(cards[1]).toHaveTextContent('Next');
    expect(cards[1]).toHaveTextContent('not available yet');
    expect(cards[2]).toHaveTextContent('Later');
    expect(places).toHaveTextContent('Nothing beyond X has a date yet.');
    expect(places).toHaveTextContent('not affiliated with, endorsed by or sponsored by X Corp.');
  });

  it('gives each place a generic icon, and the globe to a place without its own', () => {
    expect(placeIcon('x')).not.toBe(placeIcon('email'));
    expect(placeIcon('somewhere new')).toBe(placeIcon('everywhere'));
  });

  it('explains how it works on X in four steps, in order', () => {
    render(<HomePage />);

    const how = region(/^A careful assistant/);
    const steps = within(within(how).getAllByRole('list')[0]!).getAllByRole('listitem');
    expect(steps).toHaveLength(STEPS.length);
    STEPS.forEach((step, i) => {
      expect(steps[i]).toHaveTextContent(`Step ${i + 1}`);
      expect(within(steps[i]!).getByRole('heading', { level: 3, name: step.title })).toBeInTheDocument();
    });
  });

  it('says deletions run only in the extension, and the website shows and plans but can’t start one', () => {
    render(<HomePage />);

    const parts = within(region(/^A careful assistant/)).getByRole('group', { name: 'Two parts, one sign-in' });
    expect(parts).toHaveTextContent('sign in once');
    expect(parts).toHaveTextContent('The account is optional');
    expect(within(parts).getByRole('heading', { level: 4, name: 'In the extension' })).toBeInTheDocument();
    expect(within(parts).getByRole('heading', { level: 4, name: 'On xomoni.com' })).toBeInTheDocument();
    expect(parts).toHaveTextContent('Does the work');
    expect(parts).toHaveTextContent(
      'Deletions only ever run here, in the X tab on your computer, and only after you type DELETE.',
    );
    expect(parts).toHaveTextContent('Shows and plans');
    expect(parts).toHaveTextContent('only fills in Xomoni’s Cleanup page, where you start it');
    expect(parts).toHaveTextContent('The website can’t start a deletion or approve one');
    expect(parts).not.toHaveTextContent('View only');
  });

  it('lists the principles, what Xomoni always and never does on X, its default pace and the risks', () => {
    render(<HomePage />);

    const safety = region('Under your oversight, within each platform’s limits.');
    const principles = within(safety).getByRole('list', { name: 'Principles' });
    expect(
      within(principles)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(PRINCIPLES.map((principle) => principle.title));
    for (const { body } of PRINCIPLES) expect(principles).toHaveTextContent(body);
    // What the servers hold, with the daily numbers on and off (#450).
    expect(principles).toHaveTextContent(
      'Our servers hold your account and job status, and your daily numbers only if you turn them on.',
    );
    expect(
      texts(within(within(safety).getByRole('list', { name: 'On X, Xomoni always' })).getAllByRole('listitem')),
    ).toEqual(ALWAYS);
    expect(
      texts(within(within(safety).getByRole('list', { name: 'On X, Xomoni never' })).getAllByRole('listitem')),
    ).toEqual(NEVER);
    const pace = within(safety).getByRole('list', { name: 'Default pace on X' });
    for (const { value, label } of LIMITS) {
      expect(within(pace).getByText(value)).toBeInTheDocument();
      expect(within(pace).getByText(label)).toBeInTheDocument();
    }
    expect(within(safety).getByRole('link', { name: 'read the risks' })).toHaveAttribute('href', '/risks');
  });

  it('never claims Xomoni follows X’s rules: it stays within X’s limits, and says X’s rules forbid automation', () => {
    const { container } = render(<HomePage />);

    const text = container.textContent;
    expect(text).not.toMatch(/within (X’s|each platform’s) rules/i);
    expect(text).not.toMatch(/follows X’s rules|allowed by X/i);
    expect(text).toContain('within each platform’s limits');
  });

  it('separates what stays on the computer from what syncs, and links the privacy policy', () => {
    render(<HomePage />);

    const privacy = region('Your posts never touch our servers.');
    expect(
      texts(within(within(privacy).getByRole('list', { name: 'Stays on your computer' })).getAllByRole('listitem')),
    ).toEqual(STAYS);
    expect(
      texts(within(within(privacy).getByRole('list', { name: 'Synced when you sign in' })).getAllByRole('listitem')),
    ).toEqual(SYNCS);
    expect(within(privacy).getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/privacy');
  });

  it('answers each question when it is opened, and hides it again', async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    const faq = region('Questions people ask first.');
    for (const { q, a } of FAQ) {
      const question = within(faq).getByRole('button', { name: q });
      expect(question).toHaveAttribute('aria-expanded', 'false');
      expect(within(faq).queryByText(a)).not.toBeInTheDocument();

      await user.click(question);

      expect(question).toHaveAttribute('aria-expanded', 'true');
      expect(within(faq).getByText(a)).toBeVisible();
    }
    // Several answers can be open at once, and each closes on its own.
    const first = within(faq).getByRole('button', { name: FAQ[0]!.q });
    await user.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(within(faq).getByText(FAQ[1]!.a)).toBeInTheDocument();
  });

  it('answers what a footprint manager is, where it works without promising a date, and the risk with its page', async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    const faq = region('Questions people ask first.');
    await user.click(within(faq).getByRole('button', { name: 'What is a digital footprint manager?' }));
    await user.click(within(faq).getByRole('button', { name: 'Which places does Xomoni work in?' }));
    expect(faq).toHaveTextContent('Today Xomoni works only on X: it doesn’t open your email or any other account.');
    expect(faq).toHaveTextContent('with no dates yet');

    expect(within(faq).queryByRole('link', { name: 'Read the risks' })).not.toBeInTheDocument();
    await user.click(within(faq).getByRole('button', { name: 'Can my account get restricted?' }));
    expect(faq).toHaveTextContent('X’s rules forbid automating its website');
    expect(within(faq).getByRole('link', { name: 'Read the risks' })).toHaveAttribute('href', '/risks');
    await user.click(within(faq).getByRole('button', { name: 'Is Xomoni made by X?' }));
    expect(faq).toHaveTextContent('not affiliated with, endorsed by or sponsored by X Corp.');
  });

  it('closes with the archive advice, the extension and the repository', () => {
    render(<HomePage />);

    const closing = region('Start with your archive.');
    expect(closing).toHaveTextContent('Download an archive of your data');
    expect(within(closing).getByRole('link', { name: 'Get the extension' })).toHaveAttribute('href', INSTALL_URL);
    expect(within(closing).getByRole('link', { name: 'Star on GitHub' })).toHaveAttribute('href', GITHUB_URL);
  });

  it('leads both install buttons to /install, with today’s words, while no store lists Xomoni', () => {
    render(<HomePage />);

    const main = screen.getByRole('main');
    const installs = within(main).getAllByRole('link', { name: 'Get the extension' });
    expect(installs).toHaveLength(2);
    for (const install of installs) {
      expect(install).toHaveAttribute('href', INSTALL_URL);
      expect(install).toHaveAttribute('data-appearance', 'primary');
      expect(install).toHaveAttribute('data-size', 'large');
    }
    expect(main).toHaveTextContent('For Chrome, Edge and Brave on desktop. Chrome Web Store listing coming soon.');
    expect(within(main).queryByRole('link', { name: /^(Add to Chrome|Get it for Edge)$/ })).not.toBeInTheDocument();
  });

  it('offers the store’s own button for the visitor’s browser once a store lists Xomoni, and says where from', () => {
    configured.listings = { chrome: CHROME_STORE, edge: EDGE_STORE };
    Object.defineProperty(window.navigator, 'userAgent', { value: EDGE_UA, configurable: true });
    render(<HomePage />);

    const main = screen.getByRole('main');
    const adds = within(main).getAllByRole('link', { name: 'Get it for Edge' });
    expect(adds).toHaveLength(2);
    for (const add of adds) expect(add).toHaveAttribute('href', EDGE_STORE);
    expect(within(region('Start with your archive.')).getByRole('link', { name: 'Get it for Edge' })).toBeVisible();
    expect(within(main).queryByRole('link', { name: 'Get the extension' })).not.toBeInTheDocument();
    expect(main).toHaveTextContent('For Chrome, Edge and Brave on desktop, from the Chrome Web Store or Edge Add-ons.');
    expect(main).not.toHaveTextContent('coming soon');
  });

  it('renders the Chrome Web Store’s button on the server, and Edge’s once hydrated in Edge, with no mismatch', async () => {
    configured.listings = { chrome: CHROME_STORE, edge: EDGE_STORE };
    Object.defineProperty(window.navigator, 'userAgent', { value: EDGE_UA, configurable: true });
    const html = renderToString(<HomePage />);
    expect(html).toContain(CHROME_STORE);
    expect(html).not.toContain(EDGE_STORE);

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <HomePage />, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(within(container).getAllByRole('link', { name: 'Get it for Edge' })).toHaveLength(2);
    container.remove();
  });

  it('offers nothing to send on a computer', () => {
    render(<HomePage />);
    expect(screen.queryByRole('button', { name: 'Send to my computer' })).not.toBeInTheDocument();
  });

  it('on a phone, offers to send the install guide to the computer instead of installing, in the hero and at the end', async () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: IPHONE, configurable: true });
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, 'share', { value: share, configurable: true });
    render(<HomePage />);

    const main = screen.getByRole('main');
    expect(within(main).queryByRole('link', { name: 'Get the extension' })).not.toBeInTheDocument();
    const [hero, closing] = within(main).getAllByRole('button', { name: 'Send to my computer' });
    expect(within(main).getByRole('link', { name: 'Sign in to your dashboard' })).toHaveAttribute('href', '/login');
    expect(within(region('Start with your archive.')).getByRole('button', { name: 'Send to my computer' })).toBe(
      closing,
    );

    await userEvent.click(hero!);
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: INSTALL_PAGE_URL }));
  });

  it('on a phone, sends the install guide even once a store lists Xomoni: the server’s store button gives way, with no mismatch', async () => {
    configured.listings = { chrome: CHROME_STORE, edge: EDGE_STORE };
    Object.defineProperty(window.navigator, 'userAgent', { value: IPHONE, configurable: true });
    const html = renderToString(<HomePage />);
    // The server can't tell a phone: it renders the computer's button, the Chrome Web Store's while the browser is
    // unknown.
    expect(html).toContain(CHROME_STORE);
    expect(html).not.toContain('Send to my computer');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <HomePage />, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    const main = within(container).getByRole('main');
    expect(within(main).getAllByRole('button', { name: 'Send to my computer' })).toHaveLength(2);
    const install = within(main).queryByRole('link', { name: /^(Add to Chrome|Get it for Edge|Get the extension)$/ });
    expect(install).not.toBeInTheDocument();
    container.remove();
  });

  it('sits between the site header and footer', async () => {
    render(<HomePage />);

    expect(await within(screen.getByRole('banner')).findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Not affiliated with X Corp.');
  });
});
