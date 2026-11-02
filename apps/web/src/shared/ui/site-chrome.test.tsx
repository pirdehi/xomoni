// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GITHUB_URL } from '@/shared/config/site';
import { GithubMark, Logo, SiteFooter, SiteHeader } from './site-chrome';

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
  it('is hidden from screen readers and takes its size from the class', () => {
    const { container } = render(<GithubMark className="size-4" />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveClass('size-4');
  });
});

describe('SiteHeader', () => {
  it('shows the default navigation and a sign-in link', () => {
    render(<SiteHeader />);

    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'Xomoni' })).toHaveAttribute('href', '/');
    expect(within(banner).getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/#how');
    expect(within(banner).getByRole('link', { name: 'Safety' })).toHaveAttribute('href', '/#safety');
    expect(within(banner).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/#privacy');
    expect(within(banner).getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', GITHUB_URL);
    expect(within(banner).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('replaces the default navigation with its children', () => {
    render(
      <SiteHeader>
        <a href="/dashboard">Dashboard</a>
      </SiteHeader>,
    );

    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(within(nav).queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'How it works' })).not.toBeInTheDocument();
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
  });
});
