// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScanJob } from '../../src/engine/runner';
import { getConnection, saveConnection } from '../../src/cloud/connection';
import { FORGOTTEN_HERE } from '../../src/cloud/sync';
import { KEPT_ON_WIPE, db, itemKey, kvGet, kvSet } from '../../src/shared/db';
import { checkMoveText } from '../../src/shared/move-file';
import { FINISHED_ID } from '../../src/shared/notify';
import { ACTION_LABELS, DEFAULT_SETTINGS, PRESETS } from '../../src/shared/settings';
import type { ActionKind, PacingRule, Settings } from '../../src/shared/types';
import { X_PUBLISHED_LIMITS, capCeilings, share } from '../../src/shared/x-limits';
import { toDateInput } from '../../src/ui/format';
import { useToasts } from '../../src/ui/hooks';
import { SettingsPage } from '../../src/ui/pages/Settings';
import { stubChrome } from '../support/chrome';
import { ME, account, pageProps, resetDb } from '../support/fixtures';
import { captureDownloads, fakeRunner, item, logEntry } from '../support/shell';

const ACTIONS: ActionKind[] = ['delete', 'unretweet', 'unlike', 'relike', 'read'];
/** The pacing table's columns, in order. */
const COLUMNS: (keyof PacingRule)[] = [
  'minDelay',
  'maxDelay',
  'batchSize',
  'batchPauseMin',
  'batchPauseMax',
  'hourlyCap',
  'dailyCap',
];

/** The number input for one action and pacing value in the pacing table. */
function cell(action: ActionKind, key: keyof PacingRule) {
  const row = screen.getByText(ACTION_LABELS[action]).closest('tr')!;
  return within(row).getAllByRole('spinbutton')[COLUMNS.indexOf(key)]!;
}

/** The settings as stored in the `kv` table: what the next job will read. */
const stored = () => kvGet<Settings | null>('settings', null);

async function waitForStored(check: (s: Settings) => void) {
  await waitFor(async () => {
    const s = await stored();
    expect(s).not.toBeNull();
    check(s!);
  });
}

/** The toasts on screen, as `useToasts` keeps them. */
type ToastsHook = { result: { current: readonly { id: number; text: string; tone: string }[] } };

/**
 * The toasts shown after `since`, the newest id seen before an action. Toasts are module-wide and stay 5 seconds, so
 * an earlier test's *All local Xomoni data was deleted* is still listed when the next test wipes (#271).
 */
function toastsAfter(toasts: ToastsHook, since: number) {
  return toasts.result.current.filter((t) => t.id > since);
}

/** The newest toast id so far: pass it to `toastsAfter` to see only what an action shows. */
function lastToastId(toasts: ToastsHook) {
  return Math.max(0, ...toasts.result.current.map((t) => t.id));
}

async function renderPage() {
  const props = await pageProps();
  render(<SettingsPage {...props} />);
  await screen.findByRole('heading', { name: 'Settings' });
  return props;
}

/** Renders the page and chooses *Custom*, where the table of every pacing value shows (#198). */
async function renderCustom() {
  await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Custom' }));
  await screen.findByRole('spinbutton', { name: `${ACTION_LABELS.delete}, Per day` });
}

let chrome: ReturnType<typeof stubChrome>;

describe('Settings page', () => {
  beforeEach(async () => {
    chrome = stubChrome();
    await resetDb();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    // Unmount first: a component's pending effect must not run against removed stubs or mocks.
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('pacing', () => {
    it('starts on Careful, told as daily and hourly caps, with no table to fill in (#198)', async () => {
      await renderPage();

      expect(screen.getByRole('button', { name: 'Careful (⅕ of X)', pressed: true })).toBeInTheDocument();
      const pace = screen.getByLabelText('Careful pace');
      for (const action of ACTIONS) {
        const rule = PRESETS.careful[action];
        expect(within(pace).getByText(ACTION_LABELS[action]).nextElementSibling).toHaveTextContent(
          `up to ${rule.dailyCap.toLocaleString('en')} a day · ${rule.hourlyCap} an hour`,
        );
      }
      expect(screen.queryAllByRole('spinbutton', { name: /, Per day$/ })).toHaveLength(0);
    });

    it('shows the table under Custom, at Careful’s numbers', async () => {
      await renderCustom();

      expect(screen.queryByLabelText('Careful pace')).not.toBeInTheDocument();
      for (const action of ACTIONS) {
        for (const key of COLUMNS) expect(cell(action, key)).toHaveValue(PRESETS.careful[action][key]);
      }
    });

    it('marks each cap field with its one-fifth ceiling', async () => {
      await renderCustom();
      for (const action of ACTIONS) {
        expect(cell(action, 'hourlyCap')).toHaveAttribute('max', String(capCeilings(action).hourlyCap));
        expect(cell(action, 'dailyCap')).toHaveAttribute('max', String(capCeilings(action).dailyCap));
      }
    });

    it('names each pacing field by its action and column, with the unit of delays', async () => {
      await renderCustom();

      expect(screen.getByRole('spinbutton', { name: `${ACTION_LABELS.unlike}, Per hour` })).toBe(
        cell('unlike', 'hourlyCap'),
      );
      expect(screen.getByRole('spinbutton', { name: `${ACTION_LABELS.delete}, Min delay (seconds)` })).toBe(
        cell('delete', 'minDelay'),
      );
      expect(screen.getByRole('spinbutton', { name: `${ACTION_LABELS.read}, Break max (seconds)` })).toBe(
        cell('read', 'batchPauseMax'),
      );
      // No two fields share a name, so a screen reader can tell every one apart.
      const names = ACTIONS.flatMap((action) => COLUMNS.map((key) => cell(action, key).getAttribute('aria-label')));
      expect(new Set(names).size).toBe(ACTIONS.length * COLUMNS.length);
    });

    it('saves an edited value at once, staying on Custom', async () => {
      await renderCustom();

      fireEvent.change(cell('delete', 'maxDelay'), { target: { value: '200' } });

      await waitForStored((s) => {
        expect(s.preset).toBe('custom');
        expect(s.pacing.delete.maxDelay).toBe(200);
      });
      expect(await screen.findByRole('button', { name: 'Custom', pressed: true })).toBeInTheDocument();
      await waitFor(() => {
        expect(cell('delete', 'maxDelay')).toHaveValue(200);
      });
      // The other values stay as they were.
      const s = await stored();
      expect(s?.pacing.delete.minDelay).toBe(PRESETS.careful.delete.minDelay);
      expect(s?.pacing.unlike).toEqual(PRESETS.careful.unlike);
    });

    it.each(ACTIONS)('never saves %s caps above one fifth of X’s limits', async (action) => {
      await renderCustom();
      const ceiling = capCeilings(action);

      fireEvent.change(cell(action, 'hourlyCap'), { target: { value: String(ceiling.hourlyCap * 10) } });
      await waitForStored((s) => {
        expect(s.pacing[action].hourlyCap).toBe(ceiling.hourlyCap);
      });
      fireEvent.change(cell(action, 'dailyCap'), { target: { value: '1000000' } });
      await waitForStored((s) => {
        expect(s.pacing[action].dailyCap).toBe(ceiling.dailyCap);
      });

      await waitFor(() => {
        expect(cell(action, 'dailyCap')).toHaveValue(ceiling.dailyCap);
      });
      expect(cell(action, 'hourlyCap')).toHaveValue(ceiling.hourlyCap);
    });

    it('saves caps below the ceiling as they are', async () => {
      await renderCustom();

      fireEvent.change(cell('delete', 'hourlyCap'), { target: { value: '5' } });
      await waitForStored((s) => {
        expect(s.pacing.delete.hourlyCap).toBe(5);
      });
    });

    it('keeps every minimum at most its maximum', async () => {
      await renderCustom();

      fireEvent.change(cell('unlike', 'minDelay'), { target: { value: '500' } });
      await waitForStored((s) => {
        expect(s.pacing.unlike.minDelay).toBe(500);
        expect(s.pacing.unlike.maxDelay).toBe(500);
      });
      fireEvent.change(cell('unlike', 'batchPauseMin'), { target: { value: '900' } });
      await waitForStored((s) => {
        expect(s.pacing.unlike.batchPauseMax).toBe(900);
      });
    });

    it('turns empty or negative values into safe ones, never faster than Careful', async () => {
      await renderCustom();

      // A delay below Careful's would let actions burst within the hourly cap: it comes back as Careful's.
      fireEvent.change(cell('delete', 'minDelay'), { target: { value: '-3' } });
      await waitForStored((s) => {
        expect(s.pacing.delete.minDelay).toBe(PRESETS.careful.delete.minDelay);
      });
      fireEvent.change(cell('delete', 'batchSize'), { target: { value: '' } });
      await waitForStored((s) => {
        expect(s.pacing.delete.batchSize).toBe(1);
      });
      fireEvent.change(cell('delete', 'hourlyCap'), { target: { value: '-20' } });
      await waitForStored((s) => {
        expect(s.pacing.delete.hourlyCap).toBe(1);
      });
    });

    it('keeps slower custom values as they are', async () => {
      await renderCustom();
      fireEvent.change(cell('delete', 'minDelay'), { target: { value: '300' } });
      await waitForStored((s) => {
        expect(s.pacing.delete).toMatchObject({ minDelay: 300, maxDelay: 300 });
      });
    });

    it('shows stored custom settings brought back inside the ceilings', async () => {
      const ceiling = capCeilings('delete');
      await kvSet('settings', {
        ...DEFAULT_SETTINGS,
        preset: 'custom',
        pacing: { ...PRESETS.careful, delete: { ...PRESETS.careful.delete, hourlyCap: 10_000, dailyCap: 10_000 } },
      });
      await renderPage();

      expect(screen.getByRole('button', { name: 'Custom', pressed: true })).toBeInTheDocument();
      expect(cell('delete', 'hourlyCap')).toHaveValue(ceiling.hourlyCap);
      expect(cell('delete', 'dailyCap')).toHaveValue(ceiling.dailyCap);
    });

    it('keeps the numbers when switching to Custom, and restores Careful’s when switching back', async () => {
      await renderPage();

      await userEvent.click(screen.getByRole('button', { name: 'Custom' }));
      await waitForStored((s) => {
        expect(s.preset).toBe('custom');
        expect(s.pacing).toEqual(PRESETS.careful);
      });
      // The setting is stored before the page draws the table it shows: wait for the table, as renderCustom does.
      await screen.findByRole('spinbutton', { name: `${ACTION_LABELS.delete}, Per day` });
      fireEvent.change(cell('read', 'minDelay'), { target: { value: '30' } });
      await waitForStored((s) => {
        expect(s.pacing.read.minDelay).toBe(30);
      });

      await userEvent.click(screen.getByRole('button', { name: 'Careful (⅕ of X)' }));
      await waitForStored((s) => {
        expect(s.preset).toBe('careful');
        expect(s.pacing).toEqual(PRESETS.careful);
      });
      expect(await screen.findByLabelText('Careful pace')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Custom' }));
      await waitFor(() => {
        expect(cell('read', 'minDelay')).toHaveValue(PRESETS.careful.read.minDelay);
      });
    });

    it('keeps both of pacing’s folds in its card, below the numbers (#240)', async () => {
      await renderPage();

      const pacing = screen.getByRole('heading', { level: 2, name: 'Pacing' }).closest('section')!;
      expect(
        within(pacing).getByRole('button', { name: 'X’s published limits and Xomoni’s share' }),
      ).toBeInTheDocument();
      expect(within(pacing).getByRole('button', { name: 'Today’s use of X’s limits' })).toBeInTheDocument();
    });

    it('says what is always on in plain words, without HTTP codes (#240)', async () => {
      await renderPage();

      const always = screen.getByText('Always on').closest('div')!.parentElement!;
      expect(always).toHaveTextContent('Waits when X says “too many requests”');
      expect(always).toHaveTextContent('Stops when X says activity “looks automated”');
      expect(document.body).not.toHaveTextContent(/HTTP 429|code 88|code 226/);
    });

    it('lists X’s published limits next to the one-fifth share Xomoni uses', async () => {
      await renderPage();

      // Folded, with the dashboard's own fold (#240).
      await userEvent.click(screen.getByRole('button', { name: 'X’s published limits and Xomoni’s share' }));
      const table = screen.getByRole('columnheader', { name: 'Xomoni uses at most' }).closest('table')!;
      const rows = within(table).getAllByRole('row').slice(1);
      const limits = Object.values(X_PUBLISHED_LIMITS);
      expect(rows).toHaveLength(limits.length);
      limits.forEach((limit, i) => {
        const cells = within(rows[i]!).getAllByRole('cell');
        const per = limit.windowMs >= 86_400_000 ? 'day' : '15 min';
        expect(cells[0]).toHaveTextContent(limit.label);
        expect(cells[1]).toHaveTextContent(`${limit.limit} per ${per}`);
        expect(cells[2]).toHaveTextContent(
          'neverUsed' in limit ? 'none: Xomoni never posts' : `${share(limit.limit)} per ${per}`,
        );
        expect(within(cells[3]!).getByRole('link')).toHaveAttribute('href', limit.source);
      });
      expect(within(rows[0]!).getAllByRole('cell')[2]).toHaveTextContent('10 per 15 min');
    });

    it('shows a toast when a change cannot be saved', async () => {
      await renderCustom();
      const toasts = renderHook(() => useToasts());
      vi.spyOn(db.kv, 'put').mockRejectedValue(new Error('The disk is full'));

      fireEvent.change(cell('delete', 'batchSize'), { target: { value: '5' } });

      await waitFor(() => {
        expect(toasts.result.current).toContainEqual(
          expect.objectContaining({ text: 'The disk is full', tone: 'critical' }),
        );
      });
    });
  });

  describe('schedule and safety', () => {
    it('turns active hours off and on, and saves the hours', async () => {
      await renderPage();
      const from = screen.getByRole('combobox', { name: 'From' });
      expect(from).toHaveValue('8');
      expect(screen.getByRole('combobox', { name: 'Until' })).toHaveValue('23');
      expect(within(from).getAllByRole('option')).toHaveLength(24);

      await userEvent.selectOptions(from, '6');
      await waitForStored((s) => {
        expect(s.activeHours).toEqual({ enabled: true, start: 6, end: 23 });
      });
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Until' }), '20');
      await waitForStored((s) => {
        expect(s.activeHours).toEqual({ enabled: true, start: 6, end: 20 });
      });

      const toggle = screen.getByRole('switch', { name: /Only work during active hours/ });
      expect(toggle).toBeChecked();
      await userEvent.click(toggle);
      await waitForStored((s) => {
        expect(s.activeHours.enabled).toBe(false);
      });
      await waitFor(() => {
        expect(screen.queryByRole('combobox', { name: 'From' })).not.toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('switch', { name: /Only work during active hours/ }));
      expect(await screen.findByRole('combobox', { name: 'From' })).toHaveValue('6');
    });

    it('keeps both of two changes made before the page re-renders: From, then Until at once (#427)', async () => {
      await renderPage();
      // Both handlers run against the same render, as when a busy computer hasn't drawn the first change yet.
      fireEvent.change(screen.getByRole('combobox', { name: 'From' }), { target: { value: '10' } });
      fireEvent.change(screen.getByRole('combobox', { name: 'Until' }), { target: { value: '18' } });
      await waitForStored((s) => {
        expect(s.activeHours).toEqual({ enabled: true, start: 10, end: 18 });
      });
      await waitFor(() => {
        expect(screen.getByRole('combobox', { name: 'From' })).toHaveValue('10');
      });
      expect(screen.getByRole('combobox', { name: 'Until' })).toHaveValue('18');
    });

    it('keeps a pacing change and a switch changed at once, each from the same render (#427)', async () => {
      await renderCustom();
      await waitForStored((s) => {
        expect(s.preset).toBe('custom');
      });
      fireEvent.change(cell('delete', 'batchSize'), { target: { value: '5' } });
      fireEvent.click(screen.getByRole('switch', { name: /Only work during active hours/ }));
      await waitForStored((s) => {
        expect(s.pacing.delete.batchSize).toBe(5);
        expect(s.activeHours.enabled).toBe(false);
      });
    });

    it('sends a test notification and turns notifications off', async () => {
      await renderPage();

      await userEvent.click(screen.getByRole('button', { name: 'Send a test' }));
      await waitFor(() => {
        expect(chrome.notifications.create).toHaveBeenCalledWith(
          FINISHED_ID,
          expect.objectContaining({ title: 'Xomoni notifications work' }),
        );
      });

      await userEvent.click(screen.getByRole('switch', { name: /Desktop notifications/ }));
      await waitForStored((s) => {
        expect(s.notifications).toBe(false);
      });
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Send a test' })).not.toBeInTheDocument();
      });
    });

    it('keeps going while the person is away by default, and saves turning it off', async () => {
      await renderPage();
      const away = screen.getByRole('switch', { name: /Keep going while I’m away/ });
      expect(away).toBeChecked();
      expect(away).toHaveAccessibleDescription(/a covered X window comes forward and the job continues/);

      await userEvent.click(away);

      await waitForStored((s) => {
        expect(s.whileAway).toBe(false);
      });
    });

    it('keeps the failure limit, under Advanced, between 1 and 3 (#198)', async () => {
      await renderPage();
      expect(screen.getByText('A job pauses after 2 failed actions in a row.')).toBeInTheDocument();
      expect(screen.queryByRole('spinbutton', { name: 'Pause after this many failures in a row' })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Advanced', expanded: false }));
      const field = screen.getByRole('spinbutton', { name: 'Pause after this many failures in a row' });
      expect(field).toHaveValue(DEFAULT_SETTINGS.maxConsecutiveFailures);

      fireEvent.change(field, { target: { value: '9' } });
      await waitForStored((s) => {
        expect(s.maxConsecutiveFailures).toBe(3);
      });
      await waitFor(() => {
        expect(field).toHaveValue(3);
      });

      fireEvent.change(field, { target: { value: '0' } });
      await waitForStored((s) => {
        expect(s.maxConsecutiveFailures).toBe(1);
      });
      fireEvent.change(field, { target: { value: '2' } });
      await waitForStored((s) => {
        expect(s.maxConsecutiveFailures).toBe(2);
      });
      fireEvent.change(field, { target: { value: '' } });
      await waitForStored((s) => {
        expect(s.maxConsecutiveFailures).toBe(1);
      });
    });
  });

  describe('appearance and data', () => {
    it('names each theme by its own word, in a group named Theme (#345)', async () => {
      await renderPage();
      // A <label> around the buttons named the first one "Theme Light Dark" for a screen reader.
      const group = screen.getByRole('group', { name: 'Theme' });
      for (const name of ['System', 'Light', 'Dark'])
        expect(within(group).getByRole('button', { name })).toHaveAccessibleName(name);
    });

    it('switches the theme', async () => {
      await renderPage();
      const theme = (name: string) => screen.getByRole('button', { name });
      expect(theme('System')).toHaveAttribute('aria-pressed', 'true');

      await userEvent.click(theme('Dark'));
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
      expect(theme('Dark')).toHaveAttribute('aria-pressed', 'true');
      expect(localStorage.getItem('xomoni.theme')).toBe('dark');

      await userEvent.click(theme('Light'));
      expect(document.documentElement).toHaveAttribute('data-theme', 'light');

      await userEvent.click(theme('System'));
      expect(document.documentElement).not.toHaveAttribute('data-theme');
      expect(theme('System')).toHaveAttribute('aria-pressed', 'true');
      expect(localStorage.getItem('xomoni.theme')).toBeNull();
    });

    it('moves data from the Move your data card: every moved table in one dated file, with a checksum (#300)', async () => {
      const X = '1234567890';
      await db.items.add(
        item('post', 'present', { accountId: X, key: itemKey(X, 'post', '42'), id: '42', text: 'hello' }),
      );
      await db.logs.add(logEntry({ accountId: X, message: 'Deleted' }));
      const job = await createScanJob(X, 'Scan: posts', 'posts');
      const props = await pageProps({ account: account({ id: X, handle: 'mover' }) });
      render(<SettingsPage {...props} />);
      const card = (await screen.findByRole('heading', { name: 'Move your data' })).closest('section')!;
      const downloads = captureDownloads();

      await userEvent.click(within(card).getByRole('button', { name: 'Export everything' }));

      await waitFor(() => {
        expect(downloads).toHaveLength(1);
      });
      const file = downloads[0]!;
      expect(file.name).toBe(`xomoni-export-${toDateInput(Date.now())}.json`);
      expect(file.type).toBe('application/json');
      const checked = await checkMoveText(await file.text());
      if (!checked.ok) throw new Error(checked.message);
      expect(checked.file).toMatchObject({ format: 'xomoni-export', version: 2, app: '0.3.0' });
      expect(checked.file.data.accounts.map((a) => a.id)).toEqual([X]);
      expect(checked.file.data.items.map((i) => i.text)).toEqual(['hello']);
      expect(checked.file.data.jobs.map((j) => j.id)).toEqual([job.id]);
      expect(checked.file.data.logs).toHaveLength(1);
      expect(within(card).getByRole('button', { name: 'Import from a file' })).toBeEnabled();
    });

    it('asks before deleting local data and deletes nothing when cancelled', async () => {
      await db.logs.add(logEntry());
      await renderPage();

      await userEvent.click(screen.getByRole('button', { name: 'Delete local data' }));
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent('Delete all local data?');
      expect(dialog).toHaveTextContent('Nothing on X is changed.');

      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(await db.logs.count()).toBe(1);
      expect(await db.accounts.count()).toBe(1);
    });

    it('deletes every local table once confirmed', async () => {
      await db.items.add(item('like', 'present'));
      await db.logs.add(logEntry());
      await createScanJob(ME, 'Scan: likes', 'likes');
      await db.limits.put({
        key: `${ME}:DeleteTweet`,
        accountId: ME,
        op: 'DeleteTweet',
        limit: 50,
        remaining: 40,
        reset: null,
        status: 200,
        at: Date.now(),
      });
      await kvSet('settings', { ...DEFAULT_SETTINGS, notifications: false });
      await renderPage();
      const toasts = renderHook(() => useToasts());
      const since = lastToastId(toasts);

      await userEvent.click(screen.getByRole('button', { name: 'Delete local data' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete local data' }));

      await waitFor(() => {
        expect(toastsAfter(toasts, since)).toContainEqual(
          expect.objectContaining({ text: 'All local Xomoni data was deleted', tone: 'good' }),
        );
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      for (const table of [db.items, db.jobs, db.logs, db.limits, db.accounts, db.kv]) {
        expect(await table.count()).toBe(0);
      }
      // Settings are back to the defaults.
      expect(await screen.findByRole('switch', { name: /Desktop notifications/ })).toBeChecked();
    });

    it('wipes every table but the two that keep X’s limits in force, and disconnects xomoni.com first (#151)', async () => {
      const now = Date.now();
      await db.checks.add({
        accountId: ME,
        jobId: 'job-1',
        action: 'delete',
        postId: '1000000001',
        at: now,
        dueAt: now,
      });
      await db.consents.put({ accountId: ME, version: 1, at: now });
      await db.reads.add({ accountId: ME, budget: 'search', ts: now, posts: 20 });
      await db.risk.add({ accountId: ME, kind: 'rate_limited', at: now });
      await saveConnection({
        deviceId: 'd1',
        token: 't',
        deviceName: 'Chrome',
        connectedAt: 1,
        reportedUpTo: 0,
        account: 'o•••@example.com',
        confirmed: true,
      });
      const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
      vi.stubGlobal('fetch', fetch);
      await renderPage();
      const toasts = renderHook(() => useToasts());
      const since = lastToastId(toasts);

      const open = await screen.findByRole('button', { name: 'Delete local data' });
      await userEvent.click(open);
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('xomoni.com connection');
      expect(dialog).toHaveTextContent('so X’s limits still hold');
      expect(dialog).toHaveTextContent('the backup of an update that didn’t finish');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete local data' }));

      await waitFor(() => {
        expect(toastsAfter(toasts, since)).toContainEqual(
          expect.objectContaining({ text: 'All local Xomoni data was deleted' }),
        );
      });
      expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/unpair_device$/), expect.anything());
      expect(await getConnection()).toBeNull();
      for (const table of db.tables) {
        expect(await table.count(), table.name).toBe(KEPT_ON_WIPE.includes(table.name) ? 1 : 0);
      }
      expect(toastsAfter(toasts, since)).not.toContainEqual(expect.objectContaining({ text: FORGOTTEN_HERE }));
    });

    it('says to remove this browser on xomoni.com when the website couldn’t be reached', async () => {
      await saveConnection({
        deviceId: 'd1',
        token: 't',
        deviceName: 'Chrome',
        connectedAt: 1,
        reportedUpTo: 0,
        account: 'o•••@example.com',
        confirmed: true,
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
      );
      await renderPage();
      const toasts = renderHook(() => useToasts());
      const since = lastToastId(toasts);

      await userEvent.click(await screen.findByRole('button', { name: 'Delete local data' }));
      await userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete local data' }),
      );

      await waitFor(() => {
        expect(toastsAfter(toasts, since)).toContainEqual(
          expect.objectContaining({ text: FORGOTTEN_HERE, tone: 'critical' }),
        );
      });
      expect(await getConnection()).toBeNull();
    });

    it('closes the delete dialog with Escape', async () => {
      await renderPage();
      await userEvent.click(screen.getByRole('button', { name: 'Delete local data' }));
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not delete local data while a job runs', async () => {
      const fake = fakeRunner({ status: 'running', jobId: 'job-1' });
      await renderPage();

      expect(screen.getByRole('button', { name: 'Delete local data' })).toBeDisabled();

      act(() => fake.set({ status: 'idle', jobId: null }));
      expect(screen.getByRole('button', { name: 'Delete local data' })).toBeEnabled();
    });
  });
});
