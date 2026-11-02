// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthCard, AuthLegalNote, AuthLink, OrDivider } from './auth-card';

describe('AuthCard', () => {
  it('shows the logo, title, description, content and footer', () => {
    render(
      <AuthCard title="Sign in" description="Welcome back." footer={<>No account yet?</>}>
        <button type="button">Inside</button>
      </AuthCard>,
    );

    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: 'Xomoni' })).toHaveAttribute('href', '/');
    expect(within(main).getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(within(main).getByText('Welcome back.')).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: 'Inside' })).toBeInTheDocument();
    expect(within(main).getByText('No account yet?')).toBeInTheDocument();
  });

  it('leaves out the description and footer when there are none', () => {
    const { container } = render(
      <AuthCard title="Reset your password">
        <span>Body</span>
      </AuthCard>,
    );

    // Only the heading's card and the content: no empty paragraphs for a missing description or footer.
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });
});

describe('OrDivider', () => {
  it('separates the two ways to sign in', () => {
    render(<OrDivider />);

    expect(screen.getByRole('separator')).toHaveTextContent('or');
  });
});

describe('AuthLegalNote', () => {
  it('says this is not the X account and links the terms and privacy policy', () => {
    render(<AuthLegalNote />);

    expect(screen.getByText(/This is your Xomoni account, not your X account/)).toHaveTextContent(
      'Xomoni never asks for your X password.',
    );
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  });
});

describe('AuthLink', () => {
  it('links to the given path', () => {
    render(<AuthLink href="/signup">Create one</AuthLink>);

    expect(screen.getByRole('link', { name: 'Create one' })).toHaveAttribute('href', '/signup');
  });
});
