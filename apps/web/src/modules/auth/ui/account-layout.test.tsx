// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccountMain, AccountSection, AccountSkeleton } from './account-layout';

describe('AccountMain', () => {
  it('is the page’s main landmark around its sections', () => {
    render(
      <AccountMain>
        <section aria-label="Password">…</section>
        <section aria-label="Delete account">…</section>
      </AccountMain>,
    );

    const main = screen.getByRole('main');
    expect(
      within(main)
        .getAllByRole('region')
        .map((region) => region.getAttribute('aria-label')),
    ).toEqual(['Password', 'Delete account']);
  });
});

describe('AccountSkeleton', () => {
  it('tells assistive technology the account is loading', () => {
    render(<AccountSkeleton />);

    const loading = screen.getByLabelText('Loading your account');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });
});

describe('AccountSection', () => {
  it('is a region named by its heading, with its text and body', () => {
    render(
      <AccountSection title="Two-step verification" description="Off.">
        <button type="button">Turn on</button>
      </AccountSection>,
    );

    const region = screen.getByRole('region', { name: 'Two-step verification' });
    expect(within(region).getByRole('heading', { level: 2 })).toHaveTextContent('Two-step verification');
    expect(within(region).getByText('Off.')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });

  it('gives each title its own id, so two sections never share a name', () => {
    render(
      <>
        <AccountSection title="Sign-in email" description="a">
          x
        </AccountSection>
        <AccountSection title="Two-step verification" description="b" wide>
          y
        </AccountSection>
      </>,
    );

    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby'))).toEqual([
      'sign-in-email',
      'two-step-verification',
    ]);
  });
});
