// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ButtonLink, TextLink } from './links';

describe('ButtonLink', () => {
  it('links a site page, outlined by default', () => {
    render(<ButtonLink href="/login">Sign in</ButtonLink>);

    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link).toHaveAttribute('href', '/login');
    expect(link).toHaveAttribute('data-appearance', 'secondary');
    expect(link).toHaveAttribute('data-size', 'medium');
  });

  it('links outside the site with a plain link, in the appearance asked for', () => {
    render(
      <ButtonLink href="https://github.com/pirdehi/xomoni" appearance="primary" size="large">
        GitHub
      </ButtonLink>,
    );

    const link = screen.getByRole('link', { name: 'GitHub' });
    expect(link).toHaveAttribute('href', 'https://github.com/pirdehi/xomoni');
    expect(link).toHaveAttribute('data-appearance', 'primary');
    expect(link).toHaveAttribute('data-size', 'large');
  });

  it('keeps its icon out of the accessible name', () => {
    render(
      <ButtonLink href="/" appearance="subtle" icon={<svg data-testid="icon" />}>
        Home
      </ButtonLink>,
    );

    const link = screen.getByRole('link', { name: 'Home' });
    expect(link).toHaveAttribute('data-appearance', 'subtle');
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('adds the class it is given', () => {
    render(
      <ButtonLink href="/" className="extra">
        Home
      </ButtonLink>,
    );

    expect(screen.getByRole('link', { name: 'Home' })).toHaveClass('extra');
  });
});

describe('TextLink', () => {
  it('links a site page or an outside address', () => {
    render(
      <p>
        Read the <TextLink href="/privacy">privacy policy</TextLink> or{' '}
        <TextLink href="mailto:privacy@xomoni.com">write to us</TextLink>.
      </p>,
    );

    expect(screen.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'write to us' })).toHaveAttribute('href', 'mailto:privacy@xomoni.com');
  });
});
