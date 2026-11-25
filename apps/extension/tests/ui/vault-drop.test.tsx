// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/shared/db';
import { CORE_PARSERS } from '../../src/shared/vault/parsers';
import { importLedger } from '../../src/shared/vault/db';
import type * as Hooks from '../../src/ui/hooks';
import type * as VaultImport from '../../src/ui/vault-import';
import { VAULT_ACCEPT, describeResult, partsToImport, planVaultImport } from '../../src/ui/vault-import';
import { VaultDrop } from '../../src/ui/components/vault/VaultDrop';
import aug from '../../../web/e2e/fixtures/under-the-hood/aug-2026.json?raw';
import { FluentRoot } from '../../src/ui/fluent';
import { ARCHIVE_OWNER, OTHER_OWNER, buildArchive, syntheticLikes, syntheticTweets } from '../support/archive';
import { watchNetwork } from '../support/cleanup-pages';
import { account, resetDb } from '../support/fixtures';

// *Add files* on the Vault page (#425, CV.2.4): what was dropped, planned and shown before anything is written,
// confirmed, imported with progress, stopped, refused, or cancelled.

const mocks = vi.hoisted(() => ({ toast: vi.fn(), hold: null as null | Promise<void> }));

vi.mock('../../src/ui/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof Hooks>()),
  toast: mocks.toast,
}));
// The import can be held part way, to press Stop while it runs.
vi.mock('../../src/ui/vault-import', async (importOriginal) => {
  const actual = await importOriginal<typeof VaultImport>();
  return {
    ...actual,
    runVaultImport: async (...args: Parameters<typeof actual.runVaultImport>) => {
      const [plan, confirmed, options = {}] = args;
      if (mocks.hold) {
        options.onProgress?.('Saving content.csv: 2,000 / 2,005');
        await mocks.hold;
      }
      return actual.runVaultImport(plan, confirmed, options);
    },
  };
});

const ME = account({ id: ARCHIVE_OWNER.id, handle: ARCHIVE_OWNER.handle });
const DAYS_CSV = 'Date,Impressions,Likes,New follows\n"Sun, Nov 01, 2026",3210,14,3\n"Sat, Oct 31, 2026",1875,9,1\n';

function show() {
  return render(
    <FluentRoot>
      <VaultDrop account={ME} ledgerId="ledger" />
    </FluentRoot>,
  );
}

/** Drops files on the drop zone, as the person drags them there. */
function drop(files: File[]) {
  fireEvent.drop(screen.getByTestId('vault-drop'), { dataTransfer: { files } });
}

const dialog = () => screen.findByRole('dialog', { name: 'Import these files?' });

beforeEach(async () => {
  await resetDb();
  mocks.hold = null;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('planning what was dropped', () => {
  it('offers the core’s parsers in their order, and takes ZIPs, CSVs and JSON', async () => {
    expect(CORE_PARSERS.map((p) => p.source)).toEqual(['x-archive', 'x-analytics-days', 'x-analytics-posts']);
    expect(VAULT_ACCEPT).toContain('.zip');
    expect(VAULT_ACCEPT).toContain('.csv');
    expect(VAULT_ACCEPT).toContain('.json');
    const plan = await planVaultImport([await buildArchive(), new File([DAYS_CSV], 'overview.csv')], ME);
    expect(plan.parts.map((p) => p.parser.source)).toEqual(['x-archive', 'x-analytics-days']);
    expect(partsToImport(plan, new Set()).map((p) => p.parser.source)).toEqual(['x-archive']);
    expect(partsToImport(plan, new Set(plan.parts)).map((p) => p.parser.source)).toEqual([
      'x-archive',
      'x-analytics-days',
    ]);
  });
});

describe('X’s Under the hood report on the Vault page (#428)', () => {
  it('is planned after the core’s parsers, from a JSON dropped on its own', async () => {
    const plan = await planVaultImport([await buildArchive(), new File([aug], 'under_the_hood.json')], ME);
    expect(plan.parts.map((p) => p.parser.source)).toEqual(['x-archive', 'x-under-the-hood']);
    expect(plan.parts[1]?.confirm).toBe('Is this Under the hood report from @xomoni_fixture?');
  });

  it('is imported once the person says it is theirs, and its month is kept', async () => {
    show();
    drop([new File([aug], 'under_the_hood.json')]);
    const asked = await dialog();
    await userEvent.click(
      within(asked).getByRole('checkbox', { name: /Is this Under the hood report from @xomoni_fixture\?/ }),
    );
    await userEvent.click(within(asked).getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('status', { name: 'What came in' })).toHaveTextContent(
      'X’s Under the hood report: 1 row imported.',
    );
    expect((await db.labelMonths.toArray()).map((m) => [m.accountId, m.month])).toEqual([[ME.id, '2026-08']]);
  });

  it('refuses a JSON that isn’t X’s report, and writes nothing', async () => {
    show();
    drop([new File(['{"name":"a shopping list"}'], 'list.json')]);
    expect(within(await dialog()).getByRole('list', { name: 'Not imported' })).toHaveTextContent(
      'list.json: This isn’t X’s Under the hood file. Nothing was imported.',
    );
    expect(await db.labelMonths.count()).toBe(0);
  });
});

describe('VaultDrop', () => {
  it('shows what it recognized before writing anything, then imports X’s archive with what came in', async () => {
    show();
    drop([await buildArchive({ tweets: syntheticTweets(4), likes: syntheticLikes(3) })]);
    const asked = await dialog();
    expect(
      within(asked).getByText(/For @xomoni_fixture\. Nothing is written until you press Import\./),
    ).toBeInTheDocument();
    expect(within(asked).getByRole('list', { name: 'Recognized' })).toHaveTextContent(
      /X’s archive.*twitter-2026-11-08/,
    );
    expect(await db.items.count()).toBe(0);

    await userEvent.click(within(asked).getByRole('button', { name: 'Import' }));
    const status = await screen.findByRole('status', { name: 'What came in' });
    expect(status).toHaveTextContent('X’s archive: 7 rows imported.');
    expect(await db.items.count()).toBe(7);
    expect((await importLedger(ME.id)).map((r) => r.source)).toEqual(['x-archive']);
    expect(mocks.toast).toHaveBeenCalledWith('Imported into your vault', 'good');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('takes an archive and a CSV of days together, importing the CSV only once the person says it is theirs', async () => {
    show();
    drop([await buildArchive(), new File([DAYS_CSV], 'overview.csv')]);
    const asked = await dialog();
    const mine = within(asked).getByRole('checkbox', {
      name: 'This export of days has no post ids to show whose it is. Is it @xomoni_fixture’s? Yes, it’s @xomoni_fixture’s.',
    });
    await userEvent.click(mine);
    await userEvent.click(within(asked).getByRole('button', { name: 'Import' }));
    const status = await screen.findByRole('status', { name: 'What came in' });
    expect(status).toHaveTextContent('X’s archive: 5 rows imported.');
    expect(status).toHaveTextContent('X’s analytics of days: 2 rows imported.');
    expect(await db.analyticsDays.count()).toBe(2);
  });

  it('leaves out a CSV of days the person didn’t confirm', async () => {
    show();
    drop([await buildArchive(), new File([DAYS_CSV], 'overview.csv')]);
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Import' }));
    await screen.findByRole('status', { name: 'What came in' });
    expect(await db.analyticsDays.count()).toBe(0);
    expect((await importLedger(ME.id)).map((r) => r.source)).toEqual(['x-archive']);
  });

  it('refuses a file it doesn’t know and another account’s archive, saying why, and writes nothing', async () => {
    show();
    drop([new File(['png'], 'holiday.png'), await buildArchive({ account: OTHER_OWNER, name: 'theirs.zip' })]);
    const asked = await dialog();
    const refused = within(asked).getByRole('list', { name: 'Not imported' });
    expect(refused).toHaveTextContent('holiday.png: Xomoni doesn’t know this file. Nothing was imported from it.');
    expect(refused).toHaveTextContent(
      `theirs.zip: This archive belongs to @${OTHER_OWNER.handle}, not @xomoni_fixture. Nothing was imported.`,
    );
    expect(within(asked).getByRole('alert')).toHaveTextContent('Nothing here is one of X’s files that Xomoni reads.');
    expect(within(asked).getByRole('button', { name: 'Import' })).toBeDisabled();
    expect(await db.vaultImports.count()).toBe(0);
  });

  it('refuses a CSV that isn’t X’s analytics', async () => {
    show();
    drop([new File(['Date,Description,Amount\n2026-11-01,Coffee,-3'], 'bank.csv')]);
    expect(within(await dialog()).getByRole('list', { name: 'Not imported' })).toHaveTextContent(
      'bank.csv: This isn’t an X analytics export. Nothing was imported.',
    );
  });

  it('says what is wrong with a damaged ZIP, and opens no plan', async () => {
    show();
    drop([new File(['not a zip at all'], 'twitter-2026.zip')]);
    expect(await screen.findByRole('alert')).toHaveTextContent('This is not a ZIP file.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('writes nothing when the person cancels, and plans again the next time', async () => {
    show();
    const zip = await buildArchive();
    drop([zip]);
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await db.items.count()).toBe(0);
    expect(await db.vaultImports.count()).toBe(0);
    drop([zip]);
    expect(await dialog()).toBeInTheDocument();
  });

  it('warns that a file was imported before, and imports it as a duplicate that adds nothing', async () => {
    show();
    const zip = await buildArchive();
    drop([zip]);
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Import' }));
    await screen.findByRole('status', { name: 'What came in' });
    drop([zip]);
    const again = await dialog();
    expect(again).toHaveTextContent(/Already imported on .*: importing it again adds nothing\./);
    await userEvent.click(within(again).getByRole('button', { name: 'Import' }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'What came in' })).toHaveTextContent(
        'X’s archive: already imported, nothing new.',
      ),
    );
  });

  it('stops between batches on Stop, keeping what came in', async () => {
    let release: () => void = () => undefined;
    mocks.hold = new Promise<void>((resolve) => (release = resolve));
    show();
    drop([await buildArchive()]);
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Saving content.csv: 2,000 / 2,005')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    release();
    const status = await screen.findByRole('status', { name: 'What came in' });
    expect(status).toHaveTextContent('X’s archive: stopped.');
    expect(mocks.toast).toHaveBeenCalledWith('Import stopped. What came in stays.', 'good');
    expect((await importLedger(ME.id))[0]?.problems).toEqual(['cancelled']);
  });

  it('chooses files with the button, through a file input that takes X’s kinds of file', async () => {
    show();
    const input = screen.getByTestId('vault-input');
    expect(input).toHaveAttribute('accept', VAULT_ACCEPT);
    const click = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByRole('button', { name: 'Choose files' }));
    expect(click).toHaveBeenCalled();
    await userEvent.upload(input, [await buildArchive()]);
    expect(await dialog()).toBeInTheDocument();
  });

  it('sends nothing off the computer', async () => {
    const network = watchNetwork();
    show();
    drop([await buildArchive()]);
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Import' }));
    await screen.findByRole('status', { name: 'What came in' });
    expect(network.calls()).toBe(0);
  });

  it('says each result in words', () => {
    const part = { parser: { label: 'X’s archive' } } as Parameters<typeof describeResult>[0]['part'];
    const base = { part, ledger: null, duplicate: false, cancelled: false };
    expect(describeResult({ ...base, counts: { read: 3, merged: 3, skipped: 1 } })).toBe(
      'X’s archive: 3 rows imported, 1 skipped.',
    );
    expect(describeResult({ ...base, cancelled: true, counts: { read: 2, merged: 2, skipped: 0 } })).toBe(
      'X’s archive: stopped. 2 rows were kept.',
    );
  });
});
