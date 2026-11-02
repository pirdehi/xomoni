// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import {
  CONSENT_DECISION,
  CONSENT_INTRO,
  CONSENT_PHRASE,
  CONSENT_SECTIONS,
  CONSENT_TITLE,
  CONSENT_VERSION,
  X_AUTOMATION_RULES_URL,
} from '@xomoni/consent';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCleanupJob, runner } from '../../src/engine/runner';
import { db, hasConsent, upsertAccount } from '../../src/shared/db';
import type { CleanupFilter, CleanupOptions } from '../../src/shared/types';
import { ConsentDialog } from '../../src/ui/components/ConsentDialog';
import { startJob, useConsentRequest } from '../../src/ui/hooks';
import { stubChrome } from '../support/chrome';
import { ME, account, resetDb } from '../support/fixtures';

const FILTER: CleanupFilter = {
  target: 'like',
  before: Date.UTC(2020, 0, 1),
  after: null,
  keepMinLikes: null,
  keepKeywords: [],
  keepIds: [],
  skipSelfReplies: true,
};
const OPTIONS: CleanupOptions = { sweep: false, deep: false, ghostLikes: false };

const confirmInput = () => screen.getByRole('textbox', { name: `Type ${CONSENT_PHRASE} to continue` });
const continueButton = () => screen.getByRole('button', { name: 'I understand, continue' });

/** Renders the dialog and asks for consent the way the app does: by starting a job of a new account. */
async function askFor(accountId = ME) {
  const start = vi.spyOn(runner, 'start').mockResolvedValue(undefined);
  const job = await createCleanupJob(accountId, 'Unlike everything', FILTER, OPTIONS);
  const request = renderHook(() => useConsentRequest());
  let started!: Promise<void>;
  act(() => {
    started = startJob(job.id);
  });
  await waitFor(() => {
    expect(request.result.current?.accountId).toBe(accountId);
  });
  request.unmount();
  await screen.findByRole('dialog');
  return { start, job, started };
}

describe('ConsentDialog', () => {
  beforeEach(async () => {
    stubChrome();
    await resetDb();
    await upsertAccount(account());
  });
  afterEach(() => {
    // The open request is module state: decline whatever a test left open, so the next test starts clean.
    const { result, unmount } = renderHook(() => useConsentRequest());
    act(() => result.current?.answer(false));
    unmount();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows nothing until consent is asked for', () => {
    render(<ConsentDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the whole consent text and names the account', async () => {
    render(<ConsentDialog />);
    await askFor();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(CONSENT_TITLE);
    expect(dialog).toHaveTextContent(CONSENT_INTRO);
    for (const section of CONSENT_SECTIONS) {
      expect(dialog).toHaveTextContent(section.title);
      if (section.text) expect(dialog).toHaveTextContent(section.text);
      for (const point of section.points ?? []) expect(screen.getByText(point)).toBeInTheDocument();
    }
    expect(dialog).toHaveTextContent(CONSENT_DECISION);
    expect(screen.getByRole('link', { name: 'Read X’s automation rules' })).toHaveAttribute(
      'href',
      X_AUTOMATION_RULES_URL,
    );
    expect(await screen.findByText(`Type ${CONSENT_PHRASE} to continue with @me`)).toBeInTheDocument();
  });

  it('works for an account it has no handle for', async () => {
    render(<ConsentDialog />);
    await askFor('unknown-account');
    expect(screen.getByText(`Type ${CONSENT_PHRASE} to continue`)).toBeInTheDocument();
  });

  it('needs the phrase typed exactly before going ahead', async () => {
    render(<ConsentDialog />);
    const { start } = await askFor();

    expect(continueButton()).toBeDisabled();
    for (const attempt of ['i understand', 'I UNDERSTAN', 'I  UNDERSTAND', 'I UNDERSTAND.', 'yes']) {
      fireEvent.change(confirmInput(), { target: { value: attempt } });
      expect(continueButton()).toBeDisabled();
    }
    await userEvent.click(continueButton());
    expect(start).not.toHaveBeenCalled();
    expect(await hasConsent(ME)).toBe(false);
  });

  it('records consent for this account and starts the job once the phrase is typed', async () => {
    render(<ConsentDialog />);
    const { start, job, started } = await askFor();

    await userEvent.type(confirmInput(), CONSENT_PHRASE);
    expect(continueButton()).toBeEnabled();
    await userEvent.click(continueButton());
    await started;

    expect(start).toHaveBeenCalledWith(job.id);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const stored = await db.consents.get(ME);
    expect(stored?.version).toBe(CONSENT_VERSION);
    expect(await hasConsent('other-account')).toBe(false);
  });

  it('accepts the phrase with spaces around it', async () => {
    render(<ConsentDialog />);
    const { start, started } = await askFor();

    fireEvent.change(confirmInput(), { target: { value: `  ${CONSENT_PHRASE} ` } });
    await userEvent.click(continueButton());
    await started;
    expect(start).toHaveBeenCalled();
  });

  it.each([
    ['Not now', () => userEvent.click(screen.getByRole('button', { name: 'Not now' }))],
    ['the close button', () => userEvent.click(screen.getByRole('button', { name: 'Close' }))],
    ['Escape', () => userEvent.keyboard('{Escape}')],
  ])('starts nothing and records nothing when closed with %s', async (_how, close) => {
    render(<ConsentDialog />);
    const { start, started } = await askFor();
    await userEvent.type(confirmInput(), CONSENT_PHRASE);

    await close();
    await started;

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
    expect(await hasConsent(ME)).toBe(false);
  });

  it('starts nothing when the backdrop is clicked', async () => {
    render(<ConsentDialog />);
    const { start, started } = await askFor();

    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    await started;

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });

  it('starts the typed confirmation over for another account', async () => {
    render(<ConsentDialog />);
    const first = await askFor(ME);
    await userEvent.type(confirmInput(), CONSENT_PHRASE);

    const second = await askFor('other-account');
    await first.started;
    await waitFor(() => {
      expect(confirmInput()).toHaveValue('');
    });
    expect(continueButton()).toBeDisabled();
    expect(await hasConsent(ME)).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await second.started;
    expect(second.start).not.toHaveBeenCalled();
  });
});
