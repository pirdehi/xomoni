// @vitest-environment happy-dom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanView } from '../domain/plan';
import { openBillingPortal, refreshPlan } from '../server/actions';
import { BillingAccountCard, BillingSection } from './billing-section';

vi.mock('../server/actions', () => ({ startCheckout: vi.fn(), openBillingPortal: vi.fn(), refreshPlan: vi.fn() }));
const portal = vi.mocked(openBillingPortal);
const refresh = vi.mocked(refreshPlan);

const UNTIL = new Date('2026-12-24T12:00:00Z');
const known = (plan: Partial<Extract<PlanView, { state: 'known' }>> = {}): PlanView => ({
  state: 'known',
  tier: 'plus',
  status: 'active',
  validUntil: UNTIL,
  live: true,
  ...plan,
});
const region = () => screen.getByRole('region', { name: 'Plan and billing' });

describe('BillingSection (#422)', () => {
  beforeEach(() => {
    portal.mockReset().mockResolvedValue({});
    refresh.mockReset().mockResolvedValue({});
  });

  it('shows an active plan and when it renews, managed by Polar, with no card data', () => {
    render(<BillingSection plan={known()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Billing' })).toBeInTheDocument();
    expect(region()).toHaveTextContent('Your plan: Plus');
    expect(region()).toHaveTextContent('Paid through December 24, 2026.');
    expect(region()).toHaveTextContent('managed by Polar, our merchant of record. We never see your card.');
    expect(region().textContent).not.toMatch(/card ending|\*{4}|visa|mastercard/i);
  });

  it('says when a canceled plan ends, a trial ends, and a failed payment is retried', () => {
    const { unmount } = render(<BillingSection plan={known({ status: 'canceled' })} />);
    expect(region()).toHaveTextContent('Canceled: it stays until December 24, 2026, and won’t renew.');
    unmount();
    const trial = render(<BillingSection plan={known({ tier: 'pro', status: 'trialing' })} />);
    expect(region()).toHaveTextContent('Your plan: Pro');
    expect(region()).toHaveTextContent('Trial until December 24, 2026.');
    trial.unmount();
    render(<BillingSection plan={known({ status: 'past_due' })} />);
    expect(region()).toHaveTextContent('Paid until December 24, 2026, while Polar retries the payment.');
    expect(region()).toHaveTextContent('Your last payment didn’t go through.');
  });

  it('shows Free for a person who never paid, and an ended plan as ended, with data kept', () => {
    const { unmount } = render(<BillingSection plan={known({ tier: 'free', status: null, validUntil: null })} />);
    expect(region()).toHaveTextContent('Your plan: Free');
    unmount();
    render(<BillingSection plan={known({ tier: 'free', status: 'revoked' })} />);
    expect(region()).toHaveTextContent('Your paid plan has ended. Your data stays.');
  });

  it('says a plan it couldn’t read is unknown, never Free', () => {
    render(<BillingSection plan={{ state: 'unavailable', live: null }} />);
    expect(region()).toHaveTextContent('We couldn’t check your plan right now.');
    expect(region()).not.toHaveTextContent('Your plan: Free');
  });

  it('says paid plans aren’t on sale before they are', () => {
    render(<BillingSection plan={known({ tier: 'free', status: null, validUntil: null, live: false })} />);
    expect(region()).toHaveTextContent('Paid plans aren’t on sale yet.');
  });

  it('confirms the payment after a checkout until the plan shows', () => {
    const { unmount } = render(
      <BillingSection plan={known({ tier: 'free', status: null, validUntil: null })} justPaid />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Confirming your payment…');
    unmount();
    render(<BillingSection plan={known()} justPaid />);
    expect(screen.queryByText(/Confirming your payment/)).not.toBeInTheDocument();
  });

  it('opens Polar’s portal, and says when there is nothing to manage', async () => {
    portal.mockResolvedValue({ error: 'You haven’t bought a plan yet, so there is nothing to manage.' });
    render(<BillingSection plan={known({ tier: 'free', status: null, validUntil: null })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    await waitFor(() => expect(portal).toHaveBeenCalledOnce());
    expect(await screen.findByRole('alert')).toHaveTextContent('nothing to manage');
  });

  it('refreshes from Polar and says what it found, or why it couldn’t', async () => {
    refresh.mockResolvedValueOnce({ refreshed: 'applied' }).mockResolvedValueOnce({ error: 'Try again in a minute.' });
    render(<BillingSection plan={known()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Your plan is up to date with Polar.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in a minute.');
  });

  it('says when Polar has no subscription, or the plan was already up to date', async () => {
    refresh.mockResolvedValueOnce({ refreshed: 'nothing' }).mockResolvedValueOnce({ refreshed: 'unchanged' });
    render(<BillingSection plan={known()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Polar has no subscription for this account.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Your plan was already up to date.')).toBeInTheDocument();
  });

  it('links the plans', () => {
    render(<BillingSection plan={known()} />);
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/pricing');
  });
});

describe('BillingAccountCard', () => {
  it('leads from the account page to billing', () => {
    render(<BillingAccountCard />);
    expect(screen.getByRole('link', { name: 'Open billing' })).toHaveAttribute('href', '/account/billing');
  });
});
