// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/shared/db';
import { mergeAnalyticsDays, mergeAnalyticsPosts, recordImport } from '../../src/shared/vault/db';
import type { VaultImport } from '../../src/shared/vault/types';
import { utcMonth } from '../../src/shared/vault/under-the-hood';
import { ARCHIVE_PAGE_URL } from '../../src/shared/x-archive';
import type * as Hooks from '../../src/ui/hooks';
import { LEDGER_PAGE, SOURCE_LABELS, problemWords } from '../../src/ui/components/vault/ImportLedger';
import { FRESHNESS_WORDS, vaultHoldings } from '../../src/ui/components/vault/VaultSources';
import { FluentRoot } from '../../src/ui/fluent';
import { VaultPage } from '../../src/ui/pages/Vault';
import { account, resetDb } from '../support/fixtures';

// The Vault page (#425, CV.2.4): its four cards, the empty vault's way to start, the sources with their freshness and
// holdings, and the import ledger.

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../../src/ui/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof Hooks>()),
  toast: mocks.toast,
}));

const ME = account({ id: '9000000000000000001', handle: 'xomoni_fixture' });
const OTHER = '9000000000000000002';
const DAY = 86_400_000;

/** A ledger row of ME, imported `days` ago. */
function row(over: Partial<VaultImport> = {}, days = 2) {
  const at = Date.now() - days * DAY;
  return recordImport({
    accountId: ME.id,
    source: 'x-archive',
    fileName: 'twitter-2026-11-08-abc.zip',
    bytes: 2048,
    fingerprint: 'zip:00112233445566778899aabbccddeeff',
    importedAt: at,
    coverFrom: at - 400 * DAY,
    coverTo: at - DAY,
    counts: { read: 1500, merged: 1500, skipped: 0, parts: { tweets: 1200, likes: 300 } },
    parser: 'x-archive@1',
    problems: [],
    ...over,
  });
}

function show() {
  const navigate = vi.fn();
  render(
    <FluentRoot>
      <VaultPage account={ME} worker={{ open: false, info: null }} navigate={navigate} />
    </FluentRoot>,
  );
  return navigate;
}

beforeEach(resetDb);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the Vault page', () => {
  it('has its four parts, under one heading', async () => {
    show();
    expect(screen.getByRole('heading', { level: 1, name: 'Vault' })).toBeInTheDocument();
    for (const card of ['Your sources', 'Add files', 'Imports', 'Account timeline'])
      expect(await screen.findByRole('heading', { level: 2, name: card })).toBeInTheDocument();
    expect(screen.getByText(/Nothing here is sent anywhere\./)).toBeInTheDocument();
  });

  it('shows how to start when the vault is empty: X’s pages, opened by the person, or the Library', async () => {
    const navigate = show();
    expect(await screen.findByText('Your vault is empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open X’s archive page' })).toHaveAttribute('href', ARCHIVE_PAGE_URL);
    expect(screen.getByRole('link', { name: 'Open X’s Analytics' })).toHaveAttribute('target', '_blank');
    await userEvent.click(screen.getByRole('button', { name: 'Get my archive in the Library' }));
    expect(navigate).toHaveBeenCalledWith('library');
    expect(screen.getByText('No imports yet')).toBeInTheDocument();
    expect(screen.getByText('Nothing on your timeline yet')).toBeInTheDocument();
  });

  it('shows each source’s freshness and what it holds', async () => {
    await row({ coverTo: Date.now() - 40 * DAY });
    await mergeAnalyticsPosts([
      {
        accountId: ME.id,
        postId: '9000000000000000101',
        createdAt: Date.now() - 5 * DAY,
        asOf: Date.now(),
        impressions: 5,
      },
    ]);
    await mergeAnalyticsDays([
      { accountId: ME.id, day: '2026-10-01', asOf: Date.now(), impressions: 1 },
      { accountId: ME.id, day: '2026-10-31', asOf: Date.now(), impressions: 1 },
    ]);
    await row({ source: 'x-analytics-days', parser: 'x-analytics-days@1', fileName: 'overview.csv', coverTo: null }, 1);
    show();
    const sources = await screen.findByRole('list', { name: 'Your sources' });
    const [archive, analytics] = within(sources).getAllByRole('listitem');
    expect(archive).toHaveTextContent('X’s archive');
    expect(archive).toHaveTextContent('Due for a new copy');
    expect(archive).toHaveTextContent('40 days old');
    expect(archive).toHaveTextContent('1,200 posts, replies and reposts · 300 likes');
    expect(analytics).toHaveTextContent('X’s analytics export');
    expect(analytics).toHaveTextContent('Up to date');
    expect(analytics).toHaveTextContent('1 posts · 2 days, Oct 1, 2026 to Oct 31, 2026');
  });

  it('shows X’s Under the hood report with its newest import and the month it covers (#428)', async () => {
    // A month three months back, whose report X has made; its file covers a month of its own.
    const month = utcMonth(Date.now() - 90 * DAY);
    await db.labelMonths.put({ accountId: ME.id, month, importedAt: Date.now() - 3 * DAY, labels: [] });
    await row(
      {
        source: 'x-under-the-hood',
        parser: 'x-under-the-hood@1',
        fileName: 'under_the_hood.json',
        coverFrom: Date.UTC(2026, 7, 1),
        coverTo: Date.UTC(2026, 8, 1) - 1,
        counts: { read: 1, merged: 1, skipped: 0 },
      },
      3,
    );
    show();
    const sources = await screen.findByRole('list', { name: 'Your sources' });
    const report = within(sources)
      .getAllByRole('listitem')
      .find((item) => item.textContent.includes('X’s Under the hood report'));
    expect(report).toHaveTextContent('3 days old · covers Aug 1, 2026 to Aug 31, 2026');
    // With no posts in Xomoni since that month, X makes no other report: nothing is due.
    expect(report).toHaveTextContent('Up to date');
  });

  it('lists the ledger newest first, with what went wrong or was left out, 25 at a time', async () => {
    await row({ problems: [] }, 5);
    await row({ problems: ['duplicate'] }, 4);
    await row({ problems: ['cancelled'] }, 3);
    await row(
      {
        source: 'x-analytics-posts',
        parser: 'x-analytics-posts@1',
        fileName: '<img src=x onerror=alert(1)>.csv',
        problems: ['unknown-field:Vibes', 'skipped-row:3:bad-id', 'skipped-row:9:no-date'],
      },
      2,
    );
    await recordImport({
      accountId: OTHER,
      source: 'x-archive',
      fileName: 'not-mine.zip',
      bytes: 1,
      fingerprint: 'zip:00112233445566778899aabbccddeeff',
      importedAt: Date.now(),
      coverFrom: null,
      coverTo: null,
      counts: { read: 1, merged: 1, skipped: 0 },
      parser: 'x-archive@1',
      problems: [],
    });
    const { container } = render(
      <FluentRoot>
        <VaultPage account={ME} worker={{ open: false, info: null }} navigate={vi.fn()} />
      </FluentRoot>,
    );
    const table = await screen.findByRole('table', { name: 'Imports' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('<img src=x onerror=alert(1)>.csv'),
      expect.stringContaining('Stopped by you'),
      expect.stringContaining('Already imported: nothing new'),
      expect.stringContaining('1,500 imported'),
    ]);
    expect(rows[0]).toHaveTextContent('2 lines skipped');
    expect(rows[0]).toHaveTextContent('Column “Vibes” ignored');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText('not-mine.zip')).not.toBeInTheDocument();
  });

  it('pages the ledger by 25', async () => {
    for (let i = 0; i < LEDGER_PAGE + 2; i++) await row({}, i + 1);
    show();
    const table = await screen.findByRole('table', { name: 'Imports' });
    expect(within(table).getAllByRole('row')).toHaveLength(LEDGER_PAGE + 1);
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(within(table).getAllByRole('row')).toHaveLength(LEDGER_PAGE + 3);
  });
});

describe('what the page reads', () => {
  it('says each source, freshness and problem in words', () => {
    expect(SOURCE_LABELS['x-analytics-days']).toBe('X’s analytics of days');
    expect(FRESHNESS_WORDS.overdue).toEqual({ label: 'Overdue', tone: 'serious' });
    const base = { problems: [] as string[] } as unknown as VaultImport;
    expect(problemWords({ ...base, problems: ['failed'] })).toEqual({ state: 'Couldn’t finish', notes: [] });
    expect(problemWords({ ...base, problems: ['manifest-unreadable', 'truncated', 'skipped-row:2:x'] }).notes).toEqual([
      '1 line skipped',
      'The archive’s manifest couldn’t be read',
      'Only the first 500,000 rows were read',
    ]);
  });

  it('reads the holdings through the indexes, for the account only', async () => {
    await db.analyticsDays.bulkPut([
      { accountId: OTHER, day: '2026-01-01', asOf: 1, impressions: 1 },
      { accountId: ME.id, day: '2026-02-02', asOf: 1, impressions: 1 },
    ]);
    const holdings = await vaultHoldings(ME.id, Date.now());
    expect(holdings).toMatchObject({ posts: 0, days: 1, firstDay: '2026-02-02', lastDay: '2026-02-02' });
    expect(holdings.sources.map((s) => [s.source, s.freshness])).toEqual([
      ['x-archive', 'never'],
      ['x-analytics-posts', 'never'],
      ['x-under-the-hood', 'never'],
    ]);
  });
});
