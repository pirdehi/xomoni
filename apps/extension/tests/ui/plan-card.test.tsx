// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GRACE_MS } from '@xomoni/entitlements';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveConnection } from '../../src/cloud/connection';
import { LIVE_KEY, rememberPlan } from '../../src/cloud/entitlement';
import { kvSet } from '../../src/shared/db';
import { PlanCard, planLines } from '../../src/ui/components/PlanCard';
import { FluentRoot } from '../../src/ui/fluent';
import { stubChrome } from '../support/chrome';
import { resetDb } from '../support/fixtures';

const DAY = 24 * 3600_000;
// The card reads the real clock, so the plans here are heard relative to it.
const NOW = Date.now();
const UNTIL = NOW + 30 * DAY;

type Fetch = Mock<(url: string, init?: RequestInit) => Promise<Response>>;
let fetch: Fetch;

const connect = () =>
  saveConnection({
    deviceId: 'd1',
    token: 't',
    deviceName: 'Chrome',
    connectedAt: 1,
    reportedUpTo: 0,
    account: 'o•••@example.com',
    confirmed: true,
  });

const plan = (tier: 'free' | 'plus' | 'pro', status: 'active' | 'canceled' | 'past_due' | null, ago = 0) => ({
  entitlement: { tier, status, validUntil: tier === 'free' ? null : UNTIL, checkedAt: NOW - ago },
  live: true,
});

const card = () =>
  render(
    <FluentRoot>
      <PlanCard />
    </FluentRoot>,
  );

beforeEach(async () => {
  stubChrome();
  await resetDb();
  fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  );
  vi.stubGlobal('fetch', fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Your plan (#423, ADR-0042)', () => {
  it('says Plus · preview before sales open, with every Plus part free, and where plans are managed', async () => {
    card();
    const region = await screen.findByRole('region', { name: 'Your plan' });
    expect(region).toHaveTextContent('Plus · preview');
    expect(region).toHaveTextContent('Every Plus part is open, free, while Xomoni is in preview.');
    const manage = within(region).getByRole('link', { name: 'Manage on xomoni.com' });
    expect(manage.getAttribute('href')).toMatch(/^https:\/\/xomoni\.com\/account\/billing#ext=/);
    expect(manage).toHaveAttribute('rel', 'noopener noreferrer');
    // Nothing to check without a connection.
    expect(within(region).getByRole('button', { name: 'Check now' })).toBeDisabled();
    expect(screen.getByText(/every safety rail, are free on every plan/)).toBeInTheDocument();
  });

  it('says Free, and to connect, for a browser that isn’t connected once sales are open', async () => {
    await kvSet(LIVE_KEY, true);
    card();
    const region = await screen.findByRole('region', { name: 'Your plan' });
    await waitFor(() => expect(region).toHaveTextContent('Free'));
    expect(region).toHaveTextContent('Connect this browser to xomoni.com to use a plan bought there.');
  });

  it('names a paid plan, when it renews, and when it was last checked; Check now reports at once', async () => {
    await connect();
    await rememberPlan('d1', plan('plus', 'active', 60_000));
    card();
    const region = await screen.findByRole('region', { name: 'Your plan' });
    await waitFor(() => expect(region).toHaveTextContent('Plus'));
    expect(region).toHaveTextContent(/Renews on /);
    expect(region).toHaveTextContent(/Last checked /);
    await userEvent.click(within(region).getByRole('button', { name: 'Check now' }));
    await waitFor(() => expect(fetch.mock.calls.at(-1)?.[0]).toMatch(/device_report$/));
  });

  it('keeps the card readable when the check can’t reach xomoni.com', async () => {
    await connect();
    await rememberPlan('d1', plan('pro', 'active'));
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    card();
    const region = await screen.findByRole('region', { name: 'Your plan' });
    await waitFor(() => expect(region).toHaveTextContent('Pro'));
    await userEvent.click(within(region).getByRole('button', { name: 'Check now' }));
    await waitFor(() => expect(within(region).getByRole('button', { name: 'Check now' })).toBeEnabled());
    expect(region).toHaveTextContent('Pro');
  });
});

describe('the lines of Your plan', () => {
  it('says when a canceled plan ends, and a payment that didn’t go through', () => {
    expect(planLines(plan('plus', 'canceled'), NOW, 'on').lines[0]).toMatch(/^Ends on /);
    expect(planLines(plan('plus', 'past_due'), NOW, 'on').lines[0]).toBe(
      'The last payment didn’t go through: manage it on xomoni.com.',
    );
  });

  it('says it couldn’t check lately within the grace, and Free with nothing deleted after it', () => {
    expect(planLines(plan('plus', 'active', 2 * DAY), NOW, 'on')).toMatchObject({ name: 'Plus' });
    expect(planLines(plan('plus', 'active', 2 * DAY), NOW, 'on').lines).toContain(
      'Xomoni couldn’t check your plan lately. It stays on for 7 days after the last check.',
    );
    const over = planLines(plan('plus', 'active', GRACE_MS + DAY), NOW, 'on');
    expect(over.name).toBe('Free');
    expect(over.lines.join(' ')).toMatch(/counts as Free until it can\. Nothing was deleted\./);
  });

  it('says every part is open in a build without the paywall', () => {
    expect(planLines(plan('free', null), NOW, 'off').name).toBe('Every part open');
  });
});
