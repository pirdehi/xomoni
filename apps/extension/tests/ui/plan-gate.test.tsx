// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@testing-library/react';
import { GRACE_MS } from '@xomoni/entitlements';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveConnection } from '../../src/cloud/connection';
import { LIVE_KEY, rememberPlan } from '../../src/cloud/entitlement';
import { kvSet } from '../../src/shared/db';
import { GATE_WORDS, PlanGate } from '../../src/ui/components/PlanGate';
import { FluentRoot } from '../../src/ui/fluent';
import { accessOf, planIsStale, planNow } from '../../src/ui/plan';
import { stubChrome } from '../support/chrome';
import { resetDb } from '../support/fixtures';

const DAY = 24 * 3600_000;
const NOW = Date.UTC(2026, 10, 24, 12);

/** A confirmed connection of device d1. */
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

/** The plan heard for d1: `tier`, heard `ago` ms before now, with sales open unless told otherwise. */
const heard = (tier: 'free' | 'plus' | 'pro', ago = 0, live = true) =>
  rememberPlan('d1', {
    entitlement: { tier, status: tier === 'free' ? null : 'active', validUntil: NOW + 30 * DAY, checkedAt: NOW - ago },
    live,
  });

/** The gate around a Plus part, as Reach will use it. */
const renderGate = () =>
  render(
    <FluentRoot>
      <PlanGate feature="reach-history">
        <p>Each post’s reach</p>
      </PlanGate>
    </FluentRoot>,
  );

beforeEach(async () => {
  stubChrome();
  await resetDb();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PlanGate (#423, ADR-0042)', () => {
  it('opens every paid part before sales open, connected or not: a preview', async () => {
    renderGate();
    expect(await screen.findByText('Each post’s reach')).toBeInTheDocument();
    await connect();
    await heard('free', 0, false);
    expect(await screen.findByText('Each post’s reach')).toBeInTheDocument();
    expect(screen.queryByText(GATE_WORDS.plus)).not.toBeInTheDocument();
  });

  it('opens for Plus and for Pro once sales are open', async () => {
    await connect();
    await heard('plus');
    renderGate();
    expect(await screen.findByText('Each post’s reach')).toBeInTheDocument();
    cleanup();
    await heard('pro');
    renderGate();
    expect(await screen.findByText('Each post’s reach')).toBeInTheDocument();
  });

  it('closes for Free with a calm note and a link to plans on xomoni.com only, and keeps the part out of the page', async () => {
    await connect();
    await heard('free');
    renderGate();
    const gate = await screen.findByRole('region', { name: 'Part of Plus' });
    expect(gate).toHaveTextContent(GATE_WORDS.plus);
    expect(screen.queryByText('Each post’s reach')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'See plans on xomoni.com' });
    expect(new URL(link.getAttribute('href')!).origin).toBe('https://xomoni.com');
    expect(link.getAttribute('href')).toMatch(/^https:\/\/xomoni\.com\/pricing#ext=/);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('closes for a browser that isn’t connected once sales are open', async () => {
    await kvSet(LIVE_KEY, true);
    renderGate();
    expect(await screen.findByRole('region', { name: 'Part of Plus' })).toHaveAttribute('data-reason', 'free');
  });

  it('opens as soon as a plan that includes it is heard, with no reload (a purchase on xomoni.com)', async () => {
    await connect();
    await heard('free');
    renderGate();
    expect(await screen.findByRole('region', { name: 'Part of Plus' })).toBeInTheDocument();
    await heard('plus');
    expect(await screen.findByText('Each post’s reach')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Part of Plus' })).not.toBeInTheDocument();
  });

  it('opens for a plan heard after the page last ticked, never taking it for a clock gone back', async () => {
    await connect();
    await heard('free');
    renderGate();
    expect(await screen.findByRole('region', { name: 'Part of Plus' })).toBeInTheDocument();
    // The page's clock ticks once a minute: the plan arrives 30 seconds after its last tick.
    vi.setSystemTime(NOW + 30_000);
    await rememberPlan('d1', {
      entitlement: { tier: 'plus', status: 'active', validUntil: NOW + 30 * DAY, checkedAt: Date.now() },
      live: true,
    });
    expect(await screen.findByText('Each post’s reach')).toBeInTheDocument();
    expect(screen.queryByText(GATE_WORDS.clock)).not.toBeInTheDocument();
  });

  it('stays open in the grace, saying until when, once a day has passed with no answer', async () => {
    await connect();
    await heard('plus', 2 * DAY);
    renderGate();
    expect(await screen.findByText('Each post’s reach')).toBeInTheDocument();
    expect(screen.getByText('We couldn’t check your plan')).toBeInTheDocument();
    expect(screen.getByText(/Plus stays on until/)).toBeInTheDocument();
  });

  it('says nothing about the grace while the plan was heard today', async () => {
    await connect();
    await heard('plus', 3600_000);
    renderGate();
    expect(await screen.findByText('Each post’s reach')).toBeInTheDocument();
    expect(screen.queryByText('We couldn’t check your plan')).not.toBeInTheDocument();
  });

  it('closes after the grace, saying nothing was deleted', async () => {
    await connect();
    await heard('plus', GRACE_MS + DAY);
    renderGate();
    expect(await screen.findByRole('region', { name: 'Part of Plus' })).toHaveTextContent(GATE_WORDS.over);
  });

  it('closes when the clock went back before the last check, and says to set it', async () => {
    await connect();
    await heard('plus', -3600_000);
    renderGate();
    expect(await screen.findByRole('region', { name: 'Part of Plus' })).toHaveTextContent(GATE_WORDS.clock);
  });
});

describe('the one check (#423)', () => {
  const state = (tier: 'free' | 'plus', checkedAt = NOW) => ({
    entitlement: { tier, status: null, validUntil: null, checkedAt },
    live: true,
  });

  it('asks @xomoni/entitlements, with the build’s paywall', () => {
    expect(accessOf(state('free'), 'reach-history', NOW)).toMatchObject({ open: false, reason: 'free' });
    expect(accessOf(state('free'), 'reach-history', NOW, 'off')).toMatchObject({ open: true, reason: 'paywall-off' });
    expect(accessOf(state('plus'), 'reach-history', NOW)).toMatchObject({ open: true, reason: 'plan' });
  });

  it('judges the plan no earlier than it arrived', () => {
    const arrived = { entitlement: null, live: true, seenAt: NOW + 5 };
    expect(planNow(arrived, NOW)).toBe(NOW + 5);
    expect(planNow(arrived, NOW + 60_000)).toBe(NOW + 60_000);
  });

  it('calls a paid plan stale after a day without an answer, and never a free one', () => {
    expect(planIsStale(state('plus', NOW - 2 * DAY), NOW)).toBe(true);
    expect(planIsStale(state('plus', NOW - 3600_000), NOW)).toBe(false);
    expect(planIsStale(state('free', NOW - 2 * DAY), NOW)).toBe(false);
    expect(planIsStale({ entitlement: null, live: true }, NOW)).toBe(false);
  });
});
