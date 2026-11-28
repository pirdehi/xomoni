// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TermsPage from './page';

describe('the terms of use and paid plans (#420)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('read as before while the server keeps the pages for paid plans off', () => {
    vi.stubEnv('BILLING_PAGES', undefined);
    render(<TermsPage />);
    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('It is not a commercial service, and it comes with no guarantee of any result.');
    expect(within(main).queryByRole('link', { name: 'Terms of Sale' })).not.toBeInTheDocument();
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
  });

  it('say paid plans are sold under the Terms of Sale, with still no guarantee, as a draft', () => {
    vi.stubEnv('BILLING_PAGES', '1');
    render(<TermsPage />);
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: 'Terms of Sale' })).toHaveAttribute('href', '/terms-of-sale');
    expect(main).toHaveTextContent('with or without one, Xomoni comes with no guarantee of any result');
    expect(main).not.toHaveTextContent('It is not a commercial service');
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });
});
