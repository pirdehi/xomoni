// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScanJob } from '../../src/engine/runner';
import { db, kvGet, kvSet } from '../../src/shared/db';
import { FINISHED_ID } from '../../src/shared/notify';
import { ACTION_LABELS, DEFAULT_SETTINGS, PRESETS } from '../../src/shared/settings';
import type { ActionKind, PacingRule, Settings } from '../../src/shared/types';
import { X_PUBLISHED_LIMITS, capCeilings, share } from '../../src/shared/x-limits';
import { toDateInput } from '../../src/ui/format';
import { useToasts } from '../../src/ui/hooks';
import { SettingsPage } from '../../src/ui/pages/Settings';
import { stubChrome } from '../support/chrome';
import { ME, pageProps, resetDb } from '../support/fixtures';
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

async function renderPage() {
  const props = await pageProps();
  render(<SettingsPage {...props} />);
  await screen.findByRole('heading', { name: 'Settings' });
  return props;
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('pacing', () => {
    it('starts on Careful, at the preset’s numbers', async () => {
      await renderPage();

      expect(screen.getByRole('button', { name: 'Careful (⅕ of X)', pressed: true })).toBeInTheDocument();
      for (const action of ACTIONS) {
        for (const key of COLUMNS) expect(cell(action, key)).toHaveValue(PRESETS.careful[action][key]);
      }
    });

    it('marks each cap field with its one-fifth ceiling', async () => {
      await renderPage();
      for (const action of ACTIONS) {
        expect(cell(action, 'hourlyCap')).toHaveAttribute('max', String(capCeilings(action).hourlyCap));
        expect(cell(action, 'dailyCap')).toHaveAttribute('max', String(capCeilings(action).dailyCap));
      }
    });

    it('saves an edited value at once and switches to Custom', async () => {
      await renderPage();

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
      await renderPage();
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
      await renderPage();

      fireEvent.change(cell('delete', 'hourlyCap'), { target: { value: '5' } });
      await waitForStored((s) => {
        expect(s.pacing.delete.hourlyCap).toBe(5);
      });
    });

    it('keeps every minimum at most its maximum', async () => {
      await renderPage();

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
      await renderPage();

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
      await renderPage();
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
      fireEvent.change(cell('read', 'minDelay'), { target: { value: '30' } });
      await waitForStored((s) => {
        expect(s.pacing.read.minDelay).toBe(30);
      });

      await userEvent.click(screen.getByRole('button', { name: 'Careful (⅕ of X)' }));
      await waitForStored((s) => {
        expect(s.preset).toBe('careful');
        expect(s.pacing).toEqual(PRESETS.careful);
      });
      await waitFor(() => {
        expect(cell('read', 'minDelay')).toHaveValue(PRESETS.careful.read.minDelay);
      });
    });

    it('lists X’s published limits next to the one-fifth share Xomoni uses', async () => {
      await renderPage();

      expect(screen.getByText("X's published limits and Xomoni's share")).toBeInTheDocument();
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
      await renderPage();
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

    it('sends a test notification and turns notifications off', async () => {
      await renderPage();

      await userEvent.click(screen.getByRole('button', { name: 'Test' }));
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
        expect(screen.queryByRole('button', { name: 'Test' })).not.toBeInTheDocument();
      });
    });

    it('keeps the failure limit between 1 and 3', async () => {
      await renderPage();
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
    it('switches the theme', async () => {
      await renderPage();
      // The Theme field's <label> wraps the whole button row and lends its text to the buttons' names, so the
      // buttons are found by their own text.
      const theme = (name: string) => screen.getByText(name, { selector: 'button' });
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

    it('exports every local table as one dated JSON file', async () => {
      await db.items.add(item('post', 'present', { text: 'hello' }));
      await db.logs.add(logEntry({ message: 'Deleted' }));
      const job = await createScanJob(ME, 'Scan: posts', 'posts');
      await renderPage();
      const downloads = captureDownloads();

      await userEvent.click(screen.getByRole('button', { name: 'Export everything' }));

      await waitFor(() => {
        expect(downloads).toHaveLength(1);
      });
      const file = downloads[0]!;
      expect(file.name).toBe(`xomoni-export-${toDateInput(Date.now())}.json`);
      expect(file.type).toBe('application/json');
      const data = JSON.parse(await file.text()) as Record<string, { id?: string; text?: string }[]>;
      expect(Object.keys(data).sort()).toEqual(['accounts', 'exportedAt', 'items', 'jobs', 'logs']);
      expect(data.accounts?.map((a) => a.id)).toEqual([ME]);
      expect(data.items?.map((i) => i.text)).toEqual(['hello']);
      expect(data.jobs?.map((j) => j.id)).toEqual([job.id]);
      expect(data.logs).toHaveLength(1);
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

      await userEvent.click(screen.getByRole('button', { name: 'Delete local data' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete local data' }));

      await waitFor(() => {
        expect(toasts.result.current).toContainEqual(
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
