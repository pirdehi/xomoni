// @vitest-environment happy-dom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanView } from '../domain/plan';
import { startCheckout } from '../server/actions';
import { PricingPage } from './pricing-page';

vi.mock('../server/actions', () => ({ startCheckout: vi.fn(), openBillingPortal: vi.fn(), refreshPlan: vi.fn() }));
const checkout = vi.mocked(startCheckout);

const FREE: PlanView = { state: 'known', tier: 'free', status: null, validUntil: null, live: true };
const card = (name: string) => screen.getByRole('region', { name });

describe('PricingPage (#422)', () => {
  beforeEach(() => {
    checkout.mockReset();
    checkout.mockResolvedValue({});
  });

  it('shows Free, Plus, Pro and the pass, what each opens, what stays free, and no price', () => {
    render(<PricingPage plan={FREE} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Plans' })).toBeInTheDocument();
    for (const name of ['Free', 'Plus', 'Pro', '30 days of Plus']) expect(card(name)).toBeInTheDocument();
    expect(card('Free')).toHaveTextContent('Every safety limit Xomoni keeps on X');
    expect(card('Free')).toHaveTextContent('Exporting, deleting or moving your data');
    expect(card('Plus')).toHaveTextContent('Comparisons: posts with links, media or Premium, by day and hour');
    expect(card('Pro')).toHaveTextContent('Reach on xomoni.com, in the same browser');
    expect(screen.getByRole('main')).toHaveTextContent('We never see your X data. Payments by Polar.');
    expect(screen.getByRole('main').textContent).not.toMatch(/[$€£]\s?\d/);
    expect(screen.getByRole('main')).toHaveTextContent('shown on Polar’s checkout before you pay');
  });

  it('before sales open: Plus · preview and Coming soon, with nothing to buy', async () => {
    render(<PricingPage plan={{ ...FREE, live: false }} />);
    expect(screen.getByText(/aren’t on sale yet/)).toBeInTheDocument();
    expect(within(card('Plus')).getByText('Plus · preview')).toBeInTheDocument();
    const soon = within(card('Pro')).getByRole('button', { name: 'Pro: coming soon' });
    expect(soon).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(soon);
    expect(checkout).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Buy/ })).not.toBeInTheDocument();
  });

  it('for a visitor once sales are open: sign in to buy, and back here', () => {
    render(<PricingPage plan={{ state: 'signed_out', live: true }} />);
    expect(within(card('Plus')).getByRole('link', { name: 'Sign in to buy Plus' })).toHaveAttribute(
      'href',
      '/login?next=%2Fpricing',
    );
  });

  it('sells nothing when it couldn’t tell whether sales are open', () => {
    render(<PricingPage plan={{ state: 'unavailable', live: null }} />);
    expect(screen.getByText(/couldn’t check your plan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Buy/ })).not.toBeInTheDocument();
  });

  it('buys Plus monthly, or yearly once the period is switched, through the Server Action', async () => {
    render(<PricingPage plan={FREE} />);
    await userEvent.click(within(card('Plus')).getByRole('button', { name: 'Buy Plus, monthly' }));
    await waitFor(() => expect(checkout).toHaveBeenCalledOnce());
    const first = checkout.mock.calls[0]![1];
    expect(Object.fromEntries(first.entries())).toEqual({ plan: 'plus', interval: 'month' });

    await userEvent.click(screen.getByRole('radio', { name: 'Yearly' }));
    await userEvent.click(within(card('Pro')).getByRole('button', { name: 'Buy Pro, yearly' }));
    await waitFor(() => expect(checkout).toHaveBeenCalledTimes(2));
    expect(Object.fromEntries(checkout.mock.calls[1]![1].entries())).toEqual({ plan: 'pro', interval: 'year' });
  });

  it('buys the pass with no period', async () => {
    render(<PricingPage plan={FREE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Buy 30 days of Plus' }));
    await waitFor(() => expect(checkout).toHaveBeenCalledOnce());
    expect(Object.fromEntries(checkout.mock.calls[0]![1].entries())).toEqual({ plan: 'pass' });
  });

  it('says why a checkout didn’t start', async () => {
    checkout.mockResolvedValue({ error: 'We couldn’t reach Polar, our payment provider. Nothing was charged.' });
    render(<PricingPage plan={FREE} />);
    await userEvent.click(within(card('Plus')).getByRole('button', { name: 'Buy Plus, monthly' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was charged.');
  });

  it('marks the plan a person has, and sends them to manage it rather than buy again', () => {
    render(<PricingPage plan={{ ...FREE, tier: 'plus', status: 'active' }} />);
    expect(within(card('Plus')).getByText('Your plan')).toBeInTheDocument();
    expect(within(card('Pro')).getByRole('link', { name: 'Manage your plan' })).toHaveAttribute(
      'href',
      '/account/billing',
    );
    expect(screen.queryByRole('button', { name: /^Buy/ })).not.toBeInTheDocument();
  });

  it('links the terms of sale, the refund policy and the privacy policy', () => {
    render(<PricingPage plan={FREE} />);
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: 'Terms of Sale' })).toHaveAttribute('href', '/terms-of-sale');
    expect(main.getByRole('link', { name: 'Refund Policy' })).toHaveAttribute('href', '/refunds');
    expect(main.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  });
});
