// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GITHUB_URL, INSTALL_URL } from '@/shared/config/site';
import { ALWAYS, FAQ, HERO_FACTS, LIMITS, NEVER, PROBLEMS, STAYS, STEPS, SYNCS } from './content';
import { HomePage } from './home-page';

// A visitor: the header's account corner reads no session.
vi.mock('@/shared/supabase/browser-session', () => ({
  watchSessionEmail: (onChange: (email: string | null) => void) => {
    onChange(null);
    return () => undefined;
  },
}));

const region = (name: string | RegExp) => screen.getByRole('region', { name });

describe('HomePage', () => {
  it('opens with the promise, the two calls to action and the facts at a glance', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Clean up your X history without handing over your password.',
      }),
    ).toBeInTheDocument();
    const main = screen.getByRole('main');
    const [install] = within(main).getAllByRole('link', { name: 'Get the extension' });
    expect(install).toHaveAttribute('href', INSTALL_URL);
    expect(install).toHaveAttribute('data-appearance', 'primary');
    expect(within(main).getByRole('link', { name: 'Sign in to your dashboard' })).toHaveAttribute('href', '/login');
    const facts = screen.getByRole('list', { name: 'At a glance' });
    expect(
      within(facts)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(HERO_FACTS);
  });

  it('shows the dashboard in the visitor’s color scheme, light by default and dark on a dark system', () => {
    const { container } = render(<HomePage />);

    const image = screen.getByRole('img', { name: /^The Xomoni dashboard/ });
    expect(image).toHaveAttribute('src', expect.stringContaining('overview.png'));
    expect(image).toHaveAttribute('width', '1440');
    expect(image).toHaveAttribute('height', '1000');
    // Eager, so the hero image isn't held back; the <picture> means only the matching file is fetched.
    expect(image).toHaveAttribute('loading', 'eager');
    const dark = container.querySelector('picture > source');
    expect(dark).toHaveAttribute('media', '(prefers-color-scheme: dark)');
    expect(dark?.getAttribute('srcset')).toContain('overview-dark.png');
  });

  it('has the sections the header links to, by id', () => {
    render(<HomePage />);

    expect(region('A careful assistant in your browser, not a bot on a server.')).toHaveAttribute('id', 'how');
    expect(region('Works with X’s protections, not against them.')).toHaveAttribute('id', 'safety');
    expect(region('Your posts never touch our servers.')).toHaveAttribute('id', 'privacy');
  });

  it('explains the problem and the four steps, in order', () => {
    render(<HomePage />);

    const problems = region('Deleting years of posts on X is harder than it should be.');
    expect(
      within(problems)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(PROBLEMS.map((p) => p.title));
    const steps = within(region(/^A careful assistant/)).getAllByRole('listitem');
    expect(steps).toHaveLength(STEPS.length);
    STEPS.forEach((step, i) => {
      expect(steps[i]).toHaveTextContent(`Step ${i + 1}`);
      expect(within(steps[i]!).getByRole('heading', { level: 3, name: step.title })).toBeInTheDocument();
    });
  });

  it('lists what Xomoni always and never does, and its default pacing', () => {
    render(<HomePage />);

    const safety = region(/^Works with X’s protections/);
    const always = within(safety).getByRole('list', { name: 'Xomoni always' });
    const never = within(safety).getByRole('list', { name: 'Xomoni never' });
    expect(
      within(always)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(ALWAYS);
    expect(
      within(never)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(NEVER);
    const pacing = within(safety).getByRole('list', { name: 'Default pacing' });
    for (const { value, label } of LIMITS) {
      expect(within(pacing).getByText(value)).toBeInTheDocument();
      expect(within(pacing).getByText(label)).toBeInTheDocument();
    }
  });

  it('says deletions run only in the extension and the website is view-only', () => {
    render(<HomePage />);

    const anywhere = region(/^The work happens in your browser/);
    expect(anywhere).toHaveTextContent('one-time code');
    expect(anywhere).toHaveTextContent('Does the work');
    expect(anywhere).toHaveTextContent('View only');
    expect(anywhere).toHaveTextContent('The website can’t start a deletion');
  });

  it('separates what stays on the computer from what syncs, and links the privacy policy', () => {
    render(<HomePage />);

    const privacy = region('Your posts never touch our servers.');
    const stays = within(privacy).getByRole('list', { name: 'Stays on your computer' });
    const syncs = within(privacy).getByRole('list', { name: 'Synced when you sign in' });
    expect(
      within(stays)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(STAYS);
    expect(
      within(syncs)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
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
