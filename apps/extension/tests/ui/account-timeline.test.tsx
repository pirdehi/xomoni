// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/shared/db';
import { TIMELINE_PAGE, addAccountEvent } from '../../src/shared/vault/db';
import { CSV_BOM } from '../../src/shared/vault/csv';
import type * as Format from '../../src/ui/format';
import type * as Hooks from '../../src/ui/hooks';
import { AccountTimeline } from '../../src/ui/components/vault/AccountTimeline';
import { FluentRoot } from '../../src/ui/fluent';
import { account, resetDb } from '../support/fixtures';

// The account's timeline on the dashboard (#425, CV.2.2): empty, grouped by month, filtered, paged, a note added by
// keyboard, and every word shown as text.

const mocks = vi.hoisted(() => ({ downloadFile: vi.fn(), toast: vi.fn() }));

vi.mock('../../src/ui/format', async (importOriginal) => ({
  ...(await importOriginal<typeof Format>()),
  downloadFile: mocks.downloadFile,
}));
vi.mock('../../src/ui/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof Hooks>()),
  toast: mocks.toast,
}));

const ME = account({ id: '9000000000000000001', handle: 'xomoni_fixture' });

/** Local noon of a day, so time zones never move an entry across months. */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();

const note = (words: string, at: number) =>
  addAccountEvent({ accountId: ME.id, kind: 'note', source: 'person', words, at }, Date.now());

function show() {
  return render(
    <FluentRoot>
      <AccountTimeline account={ME} />
    </FluentRoot>,
  );
}

beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AccountTimeline', () => {
  it('says how the timeline fills when it is empty', async () => {
    show();
    expect(await screen.findByText('Nothing on your timeline yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  it('groups entries by month, newest first, each with who said it', async () => {
    await note('An older note', day(2026, 9, 3));
    await addAccountEvent(
      {
        accountId: ME.id,
        kind: 'premium_on',
        source: 'profile',
        words: 'X showed X Premium on.',
        at: day(2026, 10, 7),
      },
      Date.now(),
    );
    await db.risk.add({ accountId: ME.id, kind: 'lock', at: day(2026, 10, 2) });
    show();
    const october = await screen.findByRole('region', { name: 'October 2026' });
    expect(
      within(october)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('X Premium on'), expect.stringContaining('Risk ladder')]);
    expect(within(october).getByText('Your profile on X')).toBeInTheDocument();
    expect(within(october).getByText('Xomoni')).toBeInTheDocument();
    const september = screen.getByRole('region', { name: 'September 2026' });
    expect(within(september).getByText('An older note')).toBeInTheDocument();
    expect(within(september).getByText('You')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['October 2026', 'September 2026']);
  });

  it('shows markup in a note as text, never as HTML', async () => {
    await note('<img src=x onerror="window.hacked=1"> <b>bold?</b>', day(2026, 10, 1));
    const { container } = show();
    expect(await screen.findByText('<img src=x onerror="window.hacked=1"> <b>bold?</b>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('keeps one kind with the filter', async () => {
    await note('Mine', day(2026, 10, 1));
    await db.risk.add({ accountId: ME.id, kind: 'rate_limited', at: day(2026, 10, 2) });
    show();
    await screen.findByText('Mine');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'risk');
    await waitFor(() => expect(screen.queryByText('Mine')).not.toBeInTheDocument());
    expect(screen.getByText('X said a limit was reached. Xomoni waited.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'x_label');
    expect(await screen.findByText('Nothing of this kind yet')).toBeInTheDocument();
  });

  it('shows 50 at a time, and older ones on request', async () => {
    await db.accountEvents.bulkAdd(
      Array.from({ length: TIMELINE_PAGE + 3 }, (_, i) => ({
        accountId: ME.id,
        kind: 'note' as const,
        source: 'person' as const,
        words: `note ${String(i)}`,
        at: day(2026, 10, 20) - i * 3_600_000,
      })),
    );
    show();
    await screen.findByText('note 0');
    expect(screen.getAllByRole('listitem')).toHaveLength(TIMELINE_PAGE);
    expect(screen.queryByText(`note ${String(TIMELINE_PAGE)}`)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(await screen.findByText(`note ${String(TIMELINE_PAGE + 2)}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show older' })).not.toBeInTheDocument();
  });

  it('adds a note with the keyboard alone', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Nothing on your timeline yet');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Add an entry' })).toHaveFocus();
    await user.keyboard('{Enter}');
    const form = await screen.findByRole('form', { name: 'Add an entry' });
    await user.type(within(form).getByRole('textbox', { name: 'Note' }), 'Appealed the label today.');
    await user.click(within(form).getByRole('button', { name: 'Add to timeline' }));
    expect(await screen.findByText('Appealed the label today.')).toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith('Added to your timeline', 'good');
    const [stored] = await db.accountEvents.toArray();
    expect(stored).toMatchObject({ kind: 'note', source: 'person', words: 'Appealed the label today.' });
    expect(screen.queryByRole('form', { name: 'Add an entry' })).not.toBeInTheDocument();
  });

  it('dates an entry of Premium the person adds, and needs no note for it', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Add an entry' }));
    const form = screen.getByRole('form', { name: 'Add an entry' });
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'What' }), 'premium_on');
    const when = within(form).getByLabelText('When');
    await userEvent.clear(when);
    await userEvent.type(when, '2026-03-14');
    await userEvent.click(within(form).getByRole('button', { name: 'Add to timeline' }));
    await waitFor(async () => expect(await db.accountEvents.count()).toBe(1));
    const [stored] = await db.accountEvents.toArray();
    expect(stored).toMatchObject({ kind: 'premium_on', source: 'person', words: 'X Premium on', at: day(2026, 3, 14) });
  });

  it('refuses a note over 500 characters, and says by how much', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Add an entry' }));
    const form = screen.getByRole('form', { name: 'Add an entry' });
    const box = within(form).getByRole('textbox', { name: 'Note' });
    await userEvent.click(box);
    await userEvent.paste('x'.repeat(503));
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription('3 characters too many: a note holds 500.');
    expect(within(form).getByRole('button', { name: 'Add to timeline' })).toBeDisabled();
    expect(await db.accountEvents.count()).toBe(0);
    await userEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Add an entry' })).not.toBeInTheDocument();
  });

  it('exports the timeline as a CSV a spreadsheet can’t run', async () => {
    await note('=HYPERLINK("https://example.invalid")', day(2026, 10, 1));
    show();
    await screen.findByText('=HYPERLINK("https://example.invalid")');
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledOnce());
    const [name, content, type] = mocks.downloadFile.mock.calls[0] as [string, string, string];
    expect(name).toMatch(/^xomoni-timeline-xomoni_fixture-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(type).toBe('text/csv');
    expect(content.startsWith(`${CSV_BOM}when,what,who said it,words\r\n`)).toBe(true);
    expect(content).toContain(`,Your note,You,"'=HYPERLINK(""https://example.invalid"")"\r\n`);
    expect(mocks.toast).toHaveBeenCalledWith('Saved your timeline. It stays on your computer.', 'good');
  });

  it('says so when the timeline can’t be saved, and saves nothing', async () => {
    await note('Mine', day(2026, 10, 1));
    mocks.downloadFile.mockImplementationOnce(() => {
      throw new Error('The browser refused the download');
    });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        'The timeline wasn’t saved: The browser refused the download',
        'critical',
      ),
    );
  });
});
