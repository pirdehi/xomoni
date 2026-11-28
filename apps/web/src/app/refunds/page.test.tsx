// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavigationThrow } from '@test/fakes/navigation';
import { CONTACT_EMAIL } from '@/shared/config/site';
import RefundsPage from './page';

// What no text about a paid plan may say (#420): that Xomoni or a plan brings a result on X, or an account back. The
// page's own disclaimers ("not that … will be unlocked or restored", "can’t restore") don't match.
const PROMISE =
  /\b(we|xomoni|a plan|your plan|it) (will|can|does) (restore|recover|unlock|unban|boost|grow|increase|get)\b|guarantee|get (your|an) account back/i;

describe('the refund policy (#420)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is not found while the server keeps the pages for paid plans off', () => {
    vi.stubEnv('BILLING_PAGES', undefined);
    expect(() => RefundsPage()).toThrow(NavigationThrow);
    vi.stubEnv('BILLING_PAGES', '0');
    expect(() => RefundsPage()).toThrow('navigate to not-found');
  });

  it('says it is a draft, not in force', () => {
    vi.stubEnv('BILLING_PAGES', '1');
    render(<RefundsPage />);
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Refund Policy' })).toBeInTheDocument();
    expect(within(main).getByText('Draft')).toBeInTheDocument();
    expect(main).toHaveTextContent('Nothing on this page is in force yet');
  });

  it('gives 14 days for a first payment, a pass and a renewal, and says how to ask', () => {
    vi.stubEnv('BILLING_PAGES', '1');
    render(<RefundsPage />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Your first 14 days',
      'Renewals',
      'How to ask',
      'After a refund',
      'Chargebacks',
      'Refunds are about the plan, not about X',
      'Your rights',
      'Changes and contact',
    ]);
    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('ask within 14 days of your first payment for it and you get all of it back');
    expect(main).toHaveTextContent('a one-time pass, within 14 days of buying it');
    expect(main).toHaveTextContent('write to us within 14 days of it and we refund that renewal');
    expect(within(main).getAllByRole('link', { name: CONTACT_EMAIL })[0]).toHaveAttribute(
      'href',
      `mailto:${CONTACT_EMAIL}`,
    );
  });

  it('deletes nothing when a plan is refunded', () => {
    vi.stubEnv('BILLING_PAGES', '1');
    render(<RefundsPage />);
    expect(screen.getByRole('heading', { level: 2, name: 'After a refund' }).nextElementSibling).toHaveTextContent(
      'Nothing is deleted: your data stays in your browser, and you can still export it.',
    );
  });

  it('promises nothing about X, and says a refund undoes nothing there', () => {
    vi.stubEnv('BILLING_PAGES', '1');
    render(<RefundsPage />);
    const section = screen.getByRole('heading', {
      level: 2,
      name: 'Refunds are about the plan, not about X',
    }).nextElementSibling;
    expect(section).toHaveTextContent('it can’t change what X does to an account');
    expect(screen.getByRole('main').textContent).not.toMatch(PROMISE);
  });

  it('links the terms of sale, and asks for nothing on the page', () => {
    vi.stubEnv('BILLING_PAGES', '1');
    const { container } = render(<RefundsPage />);
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Terms of Sale' })).toHaveAttribute(
      'href',
      '/terms-of-sale',
    );
    expect(container.querySelectorAll('form, input, textarea, select')).toHaveLength(0);
  });
});
