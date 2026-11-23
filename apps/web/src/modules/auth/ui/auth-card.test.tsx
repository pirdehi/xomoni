// @vitest-environment happy-dom
import { resetNavigation, setLocation } from '@test/fakes/navigation';
import { render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthCard, AuthLegalNote, AuthLink, AuthSwitchLink, FormSkeleton, NoScriptNote, OrDivider } from './auth-card';

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

describe('AuthSwitchLink (#244)', () => {
  beforeEach(() => resetNavigation());

  it('keeps the page to come back to, from sign-up to sign-in and back', () => {
    setLocation('/signup', 'next=/welcome');
    const { unmount } = render(<AuthSwitchLink href="/login">Sign in</AuthSwitchLink>);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=%2Fwelcome');
    unmount();

    setLocation('/login', 'next=%2Fconnect');
    render(<AuthSwitchLink href="/signup">Create an account</AuthSwitchLink>);
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup?next=%2Fconnect');
  });

  it.each(['', 'next=/dashboard', 'next=https%3A%2F%2Fevil.example%2F', 'next=//evil.example', 'other=/welcome'])(
    'links to the page alone for ?%s',
    (query) => {
      setLocation('/signup', query);
      render(<AuthSwitchLink href="/login">Sign in</AuthSwitchLink>);
      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    },
  );
});

describe('FormSkeleton', () => {
  it('tells assistive technology the form is loading', () => {
    render(<FormSkeleton />);

    expect(screen.getByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('NoScriptNote', () => {
  it('says the forms need JavaScript, in the server’s HTML, inside a noscript so only browsers without it show it', () => {
    // React leaves a noscript empty when it renders in the browser; the note matters in the server's HTML.
    const html = renderToStaticMarkup(<NoScriptNote />);
    expect(html).toMatch(/^<noscript>.*Turn on JavaScript to continue.*<\/noscript>$/);
  });
});
