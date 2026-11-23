// @vitest-environment happy-dom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReadAnswer, SettingsAnswer, SettingsChange, XomoniSettings } from '@xomoni/bridge';
import { describe, expect, it, vi } from 'vitest';
import type { XomoniControls } from '@/modules/extension/ui/xomoni-actions';
import { SettingsPlace } from './settings-place';

const MINE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';

function settings(over: Partial<XomoniSettings> = {}): XomoniSettings {
  return {
    preset: 'careful',
    pace: {
      delete: { perHour: 10, perDay: 100 },
      unretweet: { perHour: 10, perDay: 100 },
      unlike: { perHour: 20, perDay: 200 },
      relike: { perHour: 4, perDay: 40 },
      read: { perHour: 120, perDay: 1500 },
    },
    activeHours: { enabled: true, start: 8, end: 23 },
    notifications: true,
    whileAway: true,
    maxFailures: 2,
    handle: 'ada',
    watch: ['xomoni', ''],
    ...over,
  };
}

/**
 * A `useXomoni` stand-in with Xomoni here: reads answer `stored`, and a change is applied the way Xomoni would, unless
 * `answer` says otherwise.
 */
function controls(
  stored: XomoniSettings | null,
  answer?: (change: SettingsChange) => SettingsAnswer | null,
  presence: XomoniControls['presence'] = { kind: 'here', deviceId: MINE },
) {
  let current = stored;
  const read = vi.fn((): Promise<ReadAnswer | null> =>
    Promise.resolve(current ? { ok: true, what: 'settings', settings: current } : { ok: false, reason: 'no_answer' }),
  );
  const changeSettings = vi.fn((change: SettingsChange): Promise<SettingsAnswer | null> => {
    if (answer) return Promise.resolve(answer(change));
    const base = current ?? settings();
    current = {
      ...base,
      ...(change.preset && { preset: 'careful' as const }),
      ...(change.activeHours && { activeHours: change.activeHours }),
      ...(change.notifications !== undefined && { notifications: change.notifications }),
      ...(change.whileAway !== undefined && { whileAway: change.whileAway }),
      ...(change.maxFailures !== undefined && { maxFailures: change.maxFailures }),
      ...(change.watch && { watch: change.watch }),
    };
    return Promise.resolve({ ok: true, settings: current });
  });
  const xomoni: XomoniControls = {
    presence,
    request: vi.fn(() => Promise.resolve()),
    busy: null,
    ui: null,
    read,
    changeSettings,
  };
  return { xomoni, read, changeSettings };
}

const NUMBERS = <p>The numbers switch</p>;

describe('SettingsPlace (#234, ADR-0029)', () => {
  it('shows Xomoni’s pace, hours, safety and searches as Xomoni has them, and the numbers choice', async () => {
    render(<SettingsPlace xomoni={controls(settings()).xomoni} numbers={NUMBERS} />);
    const pace = await screen.findByRole('region', { name: /^Pace/ });
    expect(within(pace).getByText('Careful')).toBeInTheDocument();
    const rows = within(pace).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Delete posts & replies10100');
    expect(within(pace).queryByRole('button', { name: 'Back to Careful' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Only work during active hours' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'From' })).toHaveValue('8');
    expect(screen.getByRole('combobox', { name: 'Until' })).toHaveValue('23');
    expect(screen.getByRole('combobox', { name: /unknown failures in a row/ })).toHaveValue('2');
    expect(screen.getByRole('switch', { name: 'Desktop notifications' })).toBeChecked();
    expect(screen.getByRole('heading', { name: 'Watch searches for @ada' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search 1' })).toHaveValue('xomoni');
    expect(screen.getByText('The numbers switch')).toBeInTheDocument();
  });

  it('sets custom pacing back to Careful, and shows what Xomoni stored', async () => {
    const { xomoni, changeSettings } = controls(settings({ preset: 'custom' }));
    render(<SettingsPlace xomoni={xomoni} numbers={NUMBERS} />);
    const pace = await screen.findByRole('region', { name: /^Pace/ });
    expect(within(pace).getByText('Custom')).toBeInTheDocument();
    await userEvent.click(within(pace).getByRole('button', { name: 'Back to Careful' }));
    expect(changeSettings).toHaveBeenCalledWith({ preset: 'careful' });
    expect(await screen.findByText(/^Saved in Xomoni/)).toBeInTheDocument();
    expect(within(pace).getByText('Careful')).toBeInTheDocument();
  });

  it('changes active hours, the failure limit and the switches, one change at a time', async () => {
    const { xomoni, changeSettings } = controls(settings());
    render(<SettingsPlace xomoni={xomoni} numbers={NUMBERS} />);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'From' }), '9');
    expect(changeSettings).toHaveBeenLastCalledWith({ activeHours: { enabled: true, start: 9, end: 23 } });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'From' })).toHaveValue('9'));

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /unknown failures in a row/ }), '1');
    expect(changeSettings).toHaveBeenLastCalledWith({ maxFailures: 1 });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Desktop notifications' })).toBeEnabled());
    await userEvent.click(screen.getByRole('switch', { name: 'Desktop notifications' }));
    expect(changeSettings).toHaveBeenLastCalledWith({ notifications: false });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Keep going while away' })).toBeEnabled());
    await userEvent.click(screen.getByRole('switch', { name: 'Keep going while away' }));
    expect(changeSettings).toHaveBeenLastCalledWith({ whileAway: false });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Only work during active hours' })).toBeEnabled());
    await userEvent.click(screen.getByRole('switch', { name: 'Only work during active hours' }));
    expect(changeSettings).toHaveBeenLastCalledWith({ activeHours: { enabled: false, start: 9, end: 23 } });
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'From' })).not.toBeInTheDocument());
  });

  it('shows the hours Xomoni stored, not the ones it was sent', async () => {
    const { xomoni } = controls(settings(), () => ({
      ok: true,
      settings: settings({ activeHours: { enabled: true, start: 10, end: 23 } }),
    }));
    render(<SettingsPlace xomoni={xomoni} numbers={NUMBERS} />);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'From' }), '9');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'From' })).toHaveValue('10'));
  });

  it('edits, adds and removes Watch searches, and saves them together, trimmed', async () => {
    const { xomoni, changeSettings } = controls(settings());
    render(<SettingsPlace xomoni={xomoni} numbers={NUMBERS} />);
    const save = await screen.findByRole('button', { name: 'Save searches' });
    expect(save).toBeDisabled();
    // The first two searches always stay: they can be cleared, not removed.
    expect(screen.queryByRole('button', { name: 'Remove search 1' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Search 2' }), '  #rust ');
    await userEvent.click(screen.getByRole('button', { name: 'Add a search' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Search 3' }), 'chrome');
    await userEvent.click(screen.getByRole('button', { name: 'Add a search' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add a search' }));
    expect(screen.queryByRole('button', { name: 'Add a search' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove search 5' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove search 4' }));
    await userEvent.click(save);
    expect(changeSettings).toHaveBeenCalledWith({ watch: ['xomoni', '#rust', 'chrome'] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save searches' })).toBeDisabled());
  });

  it('says why Xomoni didn’t take a change, and keeps the settings it has', async () => {
    const refusing = controls(settings(), () => ({ ok: false, reason: 'other_account' }));
    const { unmount } = render(<SettingsPlace xomoni={refusing.xomoni} numbers={NUMBERS} />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Desktop notifications' }));
    expect(await screen.findByText(/isn’t signed in to this account, so nothing changed/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Desktop notifications' })).toBeChecked();
    unmount();

    const gone = controls(settings(), () => null);
    render(<SettingsPlace xomoni={gone.xomoni} numbers={NUMBERS} />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Desktop notifications' }));
    expect(await screen.findByText(/Xomoni didn’t answer, so nothing changed/)).toBeInTheDocument();
  });

  it('says where to make room when Xomoni refuses searches that don’t fit beside its own (#391)', async () => {
    const full = controls(settings(), () => ({ ok: false, reason: 'refused' }));
    render(<SettingsPlace xomoni={full.xomoni} numbers={NUMBERS} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add a search' }));
    const fields = screen.getAllByRole('textbox', { name: /^Search \d/ });
    await userEvent.type(fields.at(-1)!, 'one more');
    await userEvent.click(screen.getByRole('button', { name: 'Save searches' }));
    expect(
      await screen.findByText(
        /Xomoni didn’t take these searches, so nothing changed\. It may have fewer free Watch tabs/,
      ),
    ).toBeInTheDocument();
    // Another change it refuses keeps the general words.
    await userEvent.click(screen.getByRole('switch', { name: 'Desktop notifications' }));
    expect(await screen.findByText('Xomoni didn’t take that change, so nothing changed.')).toBeInTheDocument();
  });

  it('says to install the newest Xomoni when this one doesn’t know settings yet', async () => {
    const old = controls(settings(), () => ({ ok: false, reason: 'invalid' }));
    old.read.mockResolvedValue({ ok: false, reason: 'invalid' });
    const { unmount } = render(<SettingsPlace xomoni={old.xomoni} numbers={NUMBERS} />);
    expect(await screen.findByText(/older than this page and can’t show its settings here yet/)).toBeInTheDocument();
    unmount();
    const oldWrite = controls(settings(), () => ({ ok: false, reason: 'invalid' }));
    render(<SettingsPlace xomoni={oldWrite.xomoni} numbers={NUMBERS} />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Desktop notifications' }));
    expect(await screen.findByText(/can’t change its settings from here yet, so nothing changed/)).toBeInTheDocument();
  });

  it('says so when Xomoni didn’t answer the read, or knows no X account for Watch', async () => {
    const { unmount } = render(<SettingsPlace xomoni={controls(null).xomoni} numbers={NUMBERS} />);
    expect(await screen.findByText(/Xomoni didn’t answer\. Open it/)).toBeInTheDocument();
    unmount();
    render(<SettingsPlace xomoni={controls(settings({ handle: '', watch: [] })).xomoni} numbers={NUMBERS} />);
    expect(await screen.findByText(/doesn’t know an X account yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save searches' })).not.toBeInTheDocument();
  });

  it('without Xomoni here, says where the settings live, reads nothing, and still offers the numbers choice', () => {
    const { xomoni, read } = controls(settings(), undefined, { kind: 'not-installed' });
    render(<SettingsPlace xomoni={xomoni} numbers={NUMBERS} />);
    expect(screen.getByRole('region', { name: 'Xomoni’s settings: in Xomoni' })).toHaveTextContent('change only there');
    expect(screen.getByText('The numbers switch')).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });
});
