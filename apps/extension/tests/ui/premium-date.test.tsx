// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/shared/db';
import {
  PREMIUM_SAID_WORDS,
  PremiumDateDialog,
  premiumDayProblem,
} from '../../src/ui/components/reach/PremiumDateDialog';
import { ReachComparisons } from '../../src/ui/components/reach/ReachComparisons';
import { toDateInput } from '../../src/ui/format';
import type * as Hooks from '../../src/ui/hooks';
import { resetDb } from '../support/fixtures';

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../../src/ui/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof Hooks>()),
  toast: mocks.toast,
}));

const ME = { id: '1000', createdAt: Date.UTC(2020, 0, 15, 12) };
const DAY = 86_400_000;

/** Types `day` in the dialog's date field and saves. */
async function give(day: string) {
  const field = screen.getByLabelText('The day you got X Premium');
  fireEvent.change(field, { target: { value: day } });
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
}

describe('When did you get Premium? (#429, ADR-0045)', () => {
  beforeEach(resetDb);
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('refuses a day that isn’t one, one still to come, or one before the account was made', () => {
    const now = Date.UTC(2026, 10, 20, 12);
    expect(premiumDayProblem('2026-06-01', ME, now)).toBeNull();
    expect(premiumDayProblem('', ME, now)).toBe('Pick the day you got X Premium.');
    expect(premiumDayProblem('2026-02-30', ME, now)).toBe('Pick the day you got X Premium.');
    expect(premiumDayProblem('2026-12-01', ME, now)).toBe('That day is still to come. Pick the day you got X Premium.');
    expect(premiumDayProblem('2019-12-31', ME, now)).toMatch(/^That is before your X account was made, on /);
    expect(premiumDayProblem('2019-12-31', { createdAt: null }, now)).toBeNull();
  });

  it('puts the day on the timeline as the person’s own, and closes', async () => {
    const onClose = vi.fn();
    render(<PremiumDateDialog account={ME} open onClose={onClose} />);
    await give('2026-06-01');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [event] = await db.accountEvents.toArray();
    expect(event).toMatchObject({ accountId: ME.id, kind: 'premium_on', source: 'person', words: PREMIUM_SAID_WORDS });
    expect(toDateInput(event!.at)).toBe('2026-06-01');
    expect(mocks.toast).toHaveBeenCalledWith('Saved on your timeline. Reach compares from that day.', 'good');
  });

  it('says what is wrong, as an alert, and writes nothing', async () => {
    const onClose = vi.fn();
    render(<PremiumDateDialog account={ME} open onClose={onClose} />);
    await give(toDateInput(Date.now() + 3 * DAY));
    expect(screen.getByRole('alert')).toHaveTextContent('That day is still to come.');
    expect(screen.getByLabelText('The day you got X Premium')).toHaveAttribute('aria-invalid', 'true');
    await give('2019-01-01');
    expect(screen.getByRole('alert')).toHaveTextContent('That is before your X account was made');
    expect(await db.accountEvents.count()).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('writes nothing when cancelled', async () => {
    const onClose = vi.fn();
    render(<PremiumDateDialog account={ME} open onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('The day you got X Premium'), { target: { value: '2026-06-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(await db.accountEvents.count()).toBe(0);
  });

  it('is asked from the Premium card, and only when Xomoni doesn’t know the day', async () => {
    render(<ReachComparisons rows={[]} periods={[]} account={ME} />);
    const premium = screen.getByRole('region', { name: 'With Premium, against before it' });
    await userEvent.click(within(premium).getByRole('button', { name: 'When did you get Premium?' }));
    expect(await screen.findByRole('dialog', { name: 'When did you get Premium?' })).toBeInTheDocument();
    cleanup();
    render(<ReachComparisons rows={[]} periods={[{ from: Date.now() - 90 * DAY, to: null }]} account={ME} />);
    expect(screen.queryByRole('button', { name: 'When did you get Premium?' })).not.toBeInTheDocument();
    cleanup();
    render(<ReachComparisons rows={[]} periods={[]} />);
    expect(screen.queryByRole('button', { name: 'When did you get Premium?' })).not.toBeInTheDocument();
  });
});
