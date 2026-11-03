// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccountMain, AccountSkeleton } from './account-layout';

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
