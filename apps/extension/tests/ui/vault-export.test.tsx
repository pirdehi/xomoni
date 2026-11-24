// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, itemKey } from '../../src/shared/db';
import { incomingKey } from '../../src/shared/incoming';
import { addAccountEvent } from '../../src/shared/vault/db';
import type * as Export from '../../src/shared/vault/export';
import { BYTES_PER_ROW, exportRowCounts } from '../../src/shared/vault/export';
import { listZip, readZipEntry } from '../../src/shared/zip';
import type * as Format from '../../src/ui/format';
import { toDateInput } from '../../src/ui/format';
import type * as Hooks from '../../src/ui/hooks';
import { VaultExport, vaultExportName } from '../../src/ui/components/vault/VaultExport';
import { FluentRoot } from '../../src/ui/fluent';
import { account, resetDb } from '../support/fixtures';

// *Export my vault* (#426, CV.4.2, ADR-0044): what it includes by default, others' words only when ticked, formats,
// dates, the estimate, the download, cancelling and a failure.

const mocks = vi.hoisted(() => ({ downloadBlob: vi.fn(), toast: vi.fn(), hold: false }));
// The export can be held until it is cancelled, to press Cancel while it runs.
vi.mock('../../src/shared/vault/export', async (importOriginal) => {
  const actual = await importOriginal<typeof Export>();
  return {
    ...actual,
    vaultExport: (...args: Parameters<typeof actual.vaultExport>) => {
      const signal = args[2]?.signal;
      if (!mocks.hold || !signal) return actual.vaultExport(...args);
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError'))),
      );
    },
  };
});
vi.mock('../../src/ui/format', async (importOriginal) => ({
  ...(await importOriginal<typeof Format>()),
  downloadBlob: mocks.downloadBlob,
}));
vi.mock('../../src/ui/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof Hooks>()),
  toast: mocks.toast,
}));

const ME = account({ id: '9000000000000000001', handle: 'xomoni_fixture' });
const DAY = 86_400_000;

async function seed() {
  await db.items.put({
    key: itemKey(ME.id, 'post', '9000000000000000101'),
    accountId: ME.id,
    kind: 'post',
    id: '9000000000000000101',
    targetId: '9000000000000000101',
    createdAt: Date.now() - 40 * DAY,
    likedAt: null,
    text: 'An older post',
    author: ME.handle,
    inReplyToId: null,
    selfReply: false,
    likes: 1,
    reposts: 0,
    replies: 0,
    sources: ['scan'],
    status: 'present',
    seenAt: Date.now(),
    statusAt: Date.now(),
    lastJobId: null,
  });
  await addAccountEvent({ accountId: ME.id, kind: 'note', source: 'person', words: 'A note', at: Date.now() - DAY });
  await db.incoming.put({
    key: incomingKey(ME.id, '9000000000000000301'),
    accountId: ME.id,
    id: '9000000000000000301',
    author: 'fixture_friend',
    text: 'Someone else’s reply',
    createdAt: Date.now() - DAY,
    toId: '9000000000000000101',
  });
}

function show(appVersion = () => '0.7.0') {
  return render(
    <FluentRoot>
      <VaultExport account={ME} appVersion={appVersion} />
    </FluentRoot>,
  );
}

/** The files of the ZIP handed to `downloadBlob`, by path. */
async function downloaded(): Promise<{ name: string; files: Record<string, string> }> {
  await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledOnce());
  const [name, zip] = mocks.downloadBlob.mock.calls[0] as [string, Blob];
  const files: Record<string, string> = {};
  for (const entry of await listZip(zip)) files[entry.path] = new TextDecoder().decode(await readZipEntry(zip, entry));
  return { name, files };
}

beforeEach(async () => {
  await resetDb();
  await seed();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('VaultExport', () => {
  it('ticks every part of the person’s own, and not the replies others wrote, which it says hold their words', async () => {
    show();
    expect(await screen.findByRole('checkbox', { name: 'Your posts, replies and reposts (1)' })).toBeChecked();
    for (const name of [
      /^Your likes/,
      /^X’s analytics of each day/,
      /^X’s analytics of each post/,
      /^Your account’s timeline/,
      /^The imports/,
    ])
      expect(screen.getByRole('checkbox', { name })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Replies others wrote to you (1)' })).not.toBeChecked();
    expect(screen.getByText(/Contains other people’s words\./)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'CSV, for spreadsheets' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'JSON, for other tools' })).toBeChecked();
  });

  it('saves one ZIP named for the account and the day, with no one else’s words, and says it stays here', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Export my vault' }));
    const { name, files } = await downloaded();
    expect(name).toBe(`xomoni-vault-xomoni_fixture-${toDateInput(Date.now())}.zip`);
    expect(Object.keys(files)).toContain('README.txt');
    expect(Object.keys(files)).toContain('posts.csv');
    expect(Object.keys(files)).not.toContain('replies-to-you.csv');
    expect(JSON.stringify(files)).not.toContain('Someone else’s reply');
    expect(mocks.toast).toHaveBeenCalledWith(
      `Saved ${name}. It stays on your computer: Xomoni never sends it anywhere.`,
      'good',
    );
    expect(vaultExportName('', 0)).toMatch(/^xomoni-vault-account-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  it('includes the replies others wrote only when the person ticks them', async () => {
    show();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Replies others wrote to you (1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export my vault' }));
    const { files } = await downloaded();
    expect(files['replies-to-you.csv']).toContain('Someone else’s reply');
  });

  it('writes only the format chosen, and needs one', async () => {
    show();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'JSON, for other tools' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export my vault' }));
    const { files } = await downloaded();
    expect(Object.keys(files).some((f) => f.endsWith('.json') && f !== 'schema.json')).toBe(false);
    await userEvent.click(screen.getByRole('checkbox', { name: 'CSV, for spreadsheets' }));
    expect(screen.getByText('Tick CSV, JSON or both.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export my vault' })).toBeDisabled();
  });

  it('needs at least one part', async () => {
    show();
    for (const box of await screen.findAllByRole('checkbox', { checked: true })) {
      if (!/CSV|JSON/.test(box.getAttribute('aria-label') ?? box.closest('label')?.textContent ?? ''))
        await userEvent.click(box);
    }
    await waitFor(() => expect(screen.getByText('Tick at least one part to export.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Export my vault' })).toBeDisabled();
  });

  it('reads only the dates chosen, and refuses dates the wrong way round', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Choose dates' }));
    const from = screen.getByLabelText('From');
    await userEvent.type(from, toDateInput(Date.now() - 10 * DAY));
    await userEvent.click(screen.getByRole('button', { name: 'Export my vault' }));
    const { files } = await downloaded();
    expect(files['posts.csv']).not.toContain('An older post');
    expect(files['timeline.csv']).toContain('A note');

    const to = screen.getByLabelText('To (inclusive)');
    await userEvent.clear(to);
    await userEvent.type(to, toDateInput(Date.now() - 20 * DAY));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a start date on or before the end date.');
    expect(screen.getByRole('button', { name: 'Export my vault' })).toBeDisabled();
  });

  it('estimates the size from the rows, counted without reading them', async () => {
    expect(await exportRowCounts(ME.id)).toMatchObject({ posts: 1, timeline: 1, 'replies-to-you': 1 });
    show();
    const rows = 2;
    expect(
      await screen.findByText(
        `About ${String(Math.max(1, Math.round((rows * BYTES_PER_ROW * 3 + 20_000) / 1024)))} KB, with ${String(rows)} rows.`,
      ),
    ).toBeInTheDocument();
  });

  it('downloads nothing when the person cancels', async () => {
    mocks.hold = true;
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Export my vault' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Export cancelled. Nothing was saved.', 'neutral'));
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Export my vault' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    mocks.hold = false;
  });

  it('says so when the export can’t be made, and saves nothing', async () => {
    show(() => {
      throw new Error('The browser is out of space');
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Export my vault' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The export wasn’t made: The browser is out of space');
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });
});
