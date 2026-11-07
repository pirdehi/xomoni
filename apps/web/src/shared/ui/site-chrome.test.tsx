// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GITHUB_URL } from '@/shared/config/site';
import { GithubMark, Logo, SiteFooter, SiteHeader } from './site-chrome';

// A visitor: the session cookie names no one.
vi.mock('@/shared/supabase/browser-session', () => ({
  watchSessionEmail: (onChange: (email: string | null) => void) => {
    onChange(null);
    return () => undefined;
  },
}));

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
  });

  it('shows only the account corner on pages of the signed-in app', () => {
    render(<SiteHeader app />);

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'How it works' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'GitHub' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});

describe('SiteFooter', () => {
  it('credits the author, disclaims X and links the legal pages', () => {
    render(<SiteFooter />);

    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent('Not affiliated with X Corp.');
    expect(footer).toHaveTextContent('MIT license');
    expect(within(footer).getByRole('link', { name: 'Omid Pirdehi' })).toHaveAttribute(
      'href',
      'https://github.com/pirdehi',
    );
    expect(within(footer).getByRole('link', { name: 'Risks' })).toHaveAttribute('href', '/risks');
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(within(footer).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(within(footer).getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', GITHUB_URL);
    expect(within(footer).getByRole('navigation', { name: 'Legal' })).toBeInTheDocument();
  });
});
