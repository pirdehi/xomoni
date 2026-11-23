// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavigationThrow } from '@test/fakes/navigation';
import TermsOfSalePage from './page';

// What no text about a paid plan may say (#420): that Xomoni or a plan brings a result on X, or an account back. The
// page's own disclaimers ("not that … will be unlocked or restored", "can’t restore") don't match.
const PROMISE =
  /\b(we|xomoni|a plan|your plan|it) (will|can|does) (restore|recover|unlock|unban|boost|grow|increase|get)\b|guarantee|get (your|an) account back/i;

describe('the terms of sale (#420)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is not found while the server keeps the pages for paid plans off', () => {
    vi.stubEnv('BILLING_PAGES', undefined);
    expect(() => TermsOfSalePage()).toThrow(NavigationThrow);
    vi.stubEnv('BILLING_PAGES', 'true');
    expect(() => TermsOfSalePage()).toThrow('navigate to not-found');
  });

  it('says it is a draft, not in force, with nothing on sale', () => {
    vi.stubEnv('BILLING_PAGES', '1');
    render(<TermsOfSalePage />);
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Terms of Sale' })).toBeInTheDocument();
    expect(within(main).getByText('Draft')).toBeInTheDocument();
    expect(main).toHaveTextContent('Nothing on this page is in force yet, and paid plans aren’t on sale.');
  });

  it('covers who sells, what is bought, the price, renewing, cancelling, an ending plan and refunds', () => {
    vi.stubEnv('BILLING_PAGES', '1');
    render(<TermsOfSalePage />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Who sells to you',
      'What you buy',
      'Price and taxes',
      'Renewal and cancelling',
      'When a plan ends',
      'Refunds',
      'No promise about X',
      'If we stop offering a plan',
      'Your rights',
      'Changes and contact',
    ]);
    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('Paid plans are sold by Polar, our reseller and merchant of record.');
    expect(main).toHaveTextContent('Xomoni never sees or stores your card details.');
    expect(main).toHaveTextContent('You can cancel at any time');
    expect(main).toHaveTextContent('Your plan stays until the end of the period you have paid for');
    expect(main).toHaveTextContent('you keep that price for as long as your subscription stays active');
    expect(main).toHaveTextContent('Nothing is deleted: your data stays in your browser');
  });

  it('keeps data and safety free on every plan', () => {
    vi.stubEnv('BILLING_PAGES', '1');
    render(<TermsOfSalePage />);
    expect(screen.getByText(/Some things are free on every plan/)).toHaveTextContent(
      'exporting your data, deleting it, moving it to another copy of Xomoni, and every safety limit Xomoni keeps on X',
    );
  });

  it('promises nothing about results on X, or about getting an account back', () => {
    vi.stubEnv('BILLING_PAGES', '1');
    render(<TermsOfSalePage />);
    const main = screen.getByRole('main');
    const section = screen.getByRole('heading', { level: 2, name: 'No promise about X' }).nextElementSibling;
    expect(section).toHaveTextContent('It changes nothing about how X treats your account.');
    expect(section).toHaveTextContent('not that a limited, locked or suspended X account will be unlocked or restored');
    expect(section).toHaveTextContent('a suspicion is labelled as a guess');
    expect(main.textContent).not.toMatch(PROMISE);
  });

  it('links the Terms of Use, the refund policy and the risks, and asks for nothing', () => {
    vi.stubEnv('BILLING_PAGES', '1');
    const { container } = render(<TermsOfSalePage />);
    const main = within(screen.getByRole('main'));
    expect(main.getAllByRole('link', { name: 'Terms of Use' })[0]).toHaveAttribute('href', '/terms');
    expect(main.getByRole('link', { name: 'Refund Policy' })).toHaveAttribute('href', '/refunds');
    expect(main.getByRole('link', { name: 'risks page' })).toHaveAttribute('href', '/risks');
    expect(container.querySelectorAll('form, input, textarea, select')).toHaveLength(0);
  });
});
