// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GITHUB_URL, INSTALL_URL } from '@/shared/config/site';
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
    const dark = container.querySelector('picture > source');
    expect(dark).toHaveAttribute('media', '(prefers-color-scheme: dark)');
    expect(dark?.getAttribute('srcset')).toContain('overview-dark.png');
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

  it('sits between the site header and footer', async () => {
    render(<HomePage />);

    expect(await within(screen.getByRole('banner')).findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Not affiliated with X Corp.');
  });
});
