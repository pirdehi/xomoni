// @vitest-environment happy-dom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReadAnswer, VaultSummary } from '@xomoni/bridge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { XomoniControls, XomoniReadRequest } from '@/modules/extension/ui/xomoni-actions';
import { VaultCard } from './vault-card';

// *Your vault* on xomoni.com (#426): what Xomoni's vault holds, read in this browser as counts and dates only.

const NOW = Date.parse('2026-11-24T12:00:00Z');
const DAY = 86_400_000;
const MINE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';

const SUMMARY: VaultSummary = {
  handle: 'xomoni_fixture',
  sources: [
    { source: 'x-archive', lastAt: NOW - 40 * DAY, freshness: 'due', rows: 1500 },
    { source: 'x-analytics-posts', lastAt: NOW - DAY, freshness: 'fresh', rows: 12 },
    { source: 'x-analytics-days', lastAt: null, freshness: 'never', rows: 0 },
  ],
  archiveGeneratedAt: NOW - 40 * DAY,
  imports: 3,
  captureGroupsOn: 0,
};

/** A `useXomoni` stand-in: Xomoni here unless `presence` says otherwise, answering reads with `answer`. */
function controls(answer: ReadAnswer | null, presence: XomoniControls['presence'] = { kind: 'here', deviceId: MINE }) {
  const read = vi.fn((_request: XomoniReadRequest) => Promise.resolve(answer));
  const request = vi.fn(() => Promise.resolve());
  const xomoni: XomoniControls = {
    presence,
    request,
    busy: null,
    ui: null,
    read,
    changeSettings: vi.fn(() => Promise.resolve(null)),
  };
  return { xomoni, read, request };
}

afterEach(() => vi.unstubAllGlobals());

describe('VaultCard', () => {
  it('shows each of X’s files in the vault with its freshness, read as counts and dates only', async () => {
    const { xomoni, read } = controls({ ok: true, what: 'vault', vault: SUMMARY });
    render(<VaultCard xomoni={xomoni} now={NOW} />);
    const list = await screen.findByRole('list', { name: 'Your vault’s files' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'X’s archive · 1,500 rows · 40 days oldDue for a new copy',
      'X’s analytics of posts · 12 posts · 1 day oldUp to date',
      'X’s analytics of days · Not imported yetNot yet',
    ]);
    expect(screen.getByText(/X made your newest archive on Oct 15, 2026\. 3 imports in all\./)).toBeInTheDocument();
    expect(
      screen.getByText(/Only counts and dates, from Xomoni in this browser\. None of it reaches our servers\./),
    ).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith({ what: 'vault' });
  });

  it('opens the Vault page in Xomoni, and starts nothing', async () => {
    const { xomoni, request } = controls({ ok: true, what: 'vault', vault: SUMMARY });
    render(<VaultCard xomoni={xomoni} now={NOW} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open the vault in Xomoni' }));
    expect(request).toHaveBeenCalledWith({ kind: 'open', page: 'vault' });
  });

  it('says the vault is empty, and how to fill it', async () => {
    const empty: VaultSummary = {
      ...SUMMARY,
      imports: 0,
      sources: SUMMARY.sources.map((s) => ({ ...s, rows: 0, lastAt: null, freshness: 'never' as const })),
    };
    const { xomoni } = controls({ ok: true, what: 'vault', vault: empty });
    render(<VaultCard xomoni={xomoni} now={NOW} />);
    expect(
      await screen.findByText(/Your vault is empty\. Download your archive or analytics from X yourself/),
    ).toBeInTheDocument();
  });

  it('says where the vault lives without Xomoni in this browser, and reads nothing', () => {
    for (const kind of ['not-installed', 'signed-out', 'other-account', 'phone'] as const) {
      const { xomoni, read } = controls(null, { kind });
      const { unmount } = render(<VaultCard xomoni={xomoni} now={NOW} />);
      const region = screen.getByRole('region', { name: 'Your vault: in Xomoni' });
      expect(region).toHaveTextContent('is kept by Xomoni on your computer: it never reaches our servers.');
      // Named apart from the Library's *Open in Xomoni*, which the page shows beside it.
      expect(within(region).getByRole('button', { name: 'Open the vault in Xomoni' })).toBeInTheDocument();
      expect(within(region).queryByRole('button', { name: 'Open in Xomoni' })).not.toBeInTheDocument();
      expect(read).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('asks for the newest Xomoni when this one doesn’t know the read, and says when it doesn’t answer', async () => {
    const old = controls({ ok: false, reason: 'invalid' });
    const { unmount } = render(<VaultCard xomoni={old.xomoni} now={NOW} />);
    expect(
      await screen.findByText(/Your Xomoni is older than this page and can’t show your vault here yet\./),
    ).toBeInTheDocument();
    // Its link's name differs from the Library's beside it (#426).
    expect(screen.getByRole('link', { name: 'Install the newest Xomoni' })).toBeInTheDocument();
    unmount();
    const silent = controls({ ok: false, reason: 'no_answer' });
    render(<VaultCard xomoni={silent.xomoni} now={NOW} />);
    expect(
      await screen.findByText('Xomoni didn’t answer about your vault. Open it on this computer and try again.'),
    ).toBeInTheDocument();
  });

  it('keeps the answer in the page’s memory: nothing stored, nothing sent', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { xomoni } = controls({ ok: true, what: 'vault', vault: SUMMARY });
    render(<VaultCard xomoni={xomoni} now={NOW} />);
    await screen.findByRole('list', { name: 'Your vault’s files' });
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
    expect(setItem).not.toHaveBeenCalled();
  });
});
