// @vitest-environment happy-dom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XomoniActionServices } from '../client/xomoni-actions';
import { OpenInXomoni, XomoniJobActions, useXomoni, useXomoniRead } from './xomoni-actions';

const MINE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const OTHER = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/142.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

/** The link as the site last found it; tests set it. */
interface Link {
  status: string;
  deviceId?: string;
}
const link = vi.hoisted((): { current: Link } => ({ current: { status: 'unknown' } }));
vi.mock('./extension-session-sync', () => ({ useExtensionLink: () => link.current }));

let services: {
  ask: ReturnType<typeof vi.fn>;
  recheck: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
  settings: ReturnType<typeof vi.fn>;
};

/** A page with one running job of this browser and *Open in Xomoni* for the Library. */
function Page({
  jobState = 'running',
  jobDevice = MINE,
  checkWaitMs,
}: {
  jobState?: string;
  jobDevice?: string;
  checkWaitMs?: number;
}) {
  const xomoni = useXomoni([MINE], () => services as unknown as XomoniActionServices, checkWaitMs);
  return (
    <>
      {xomoni.ui}
      <XomoniJobActions
        xomoni={xomoni}
        job={{ localId: 'job-1', deviceId: jobDevice, state: jobState, title: 'Delete posts' }}
        deviceName="Chrome on Windows"
      />
      <OpenInXomoni xomoni={xomoni} page="library" />
    </>
  );
}

function userAgent(value: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true });
}

beforeEach(() => {
  userAgent(DESKTOP);
  link.current = { status: 'signed-in', deviceId: MINE };
  services = {
    ask: vi.fn(() => Promise.resolve({ ok: true, outcome: 'stopping' })),
    recheck: vi.fn(() => Promise.resolve()),
    read: vi.fn(() => Promise.resolve({ ok: true, what: 'watch', tabs: [] })),
    settings: vi.fn(() => Promise.resolve({ ok: false, reason: 'refused' })),
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  userAgent(DESKTOP);
  Reflect.deleteProperty(window.navigator, 'share');
  Reflect.deleteProperty(window.navigator, 'clipboard');
});

describe('useXomoni: when Xomoni is here (ADR-0027, #251)', () => {
  it('hands the action to Xomoni, disables the buttons meanwhile, and shows its answer', async () => {
    let finish!: (answer: unknown) => void;
    services.ask.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    render(<Page />);

    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));

    expect(services.ask).toHaveBeenCalledWith({ kind: 'job', action: 'pause', jobId: 'job-1', deviceId: MINE });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    finish({ ok: true, outcome: 'stopping' });
    expect(await screen.findByText('Pausing: the job stops after the action in progress.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/^Pausing/)).not.toBeInTheDocument();
  });

  it('shows a refusal in plain words', async () => {
    services.ask.mockResolvedValueOnce({ ok: false, reason: 'no_answer' });
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Open in Xomoni' }));
    expect(services.ask).toHaveBeenCalledWith({ kind: 'open', page: 'library', deviceId: MINE });
    expect(await screen.findByText('Xomoni didn’t answer. Open it on this computer and try again.')).toBeVisible();
  });

  it('offers Resume for a stopped job, and nothing for an ended one', () => {
    const { unmount } = render(<Page jobState="paused" />);
    expect(
      within(screen.getByRole('group', { name: 'Actions for Delete posts' }))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Resume', 'Cancel']);
    unmount();
    render(<Page jobState="completed" />);
    expect(screen.queryByRole('group', { name: 'Actions for Delete posts' })).not.toBeInTheDocument();
  });

  it('says a job of another browser runs there, and sends nothing', async () => {
    render(<Page jobDevice={OTHER} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    const dialog = await screen.findByRole('dialog', { name: 'This job runs in another browser' });
    expect(dialog).toHaveTextContent('It runs in Chrome on Windows.');
    expect(services.ask).not.toHaveBeenCalled();
  });
});

describe('useXomoni: the dialog when Xomoni isn’t here', () => {
  it('not installed: the install steps, and a check that says what to do next', async () => {
    link.current = { status: 'none' };
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Open in Xomoni' }));

    const dialog = await screen.findByRole('dialog', { name: 'You haven’t installed Xomoni yet' });
    expect(within(dialog).getByRole('link', { name: /Install Xomoni/ })).toHaveAttribute('href', '/install');
    await userEvent.click(within(dialog).getByRole('button', { name: 'I’ve installed it' }));
    expect(services.recheck).toHaveBeenCalled();
    expect(await within(dialog).findByText(/isn’t linked to this page yet/)).toBeInTheDocument();
    expect(services.ask).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('on a phone: Xomoni runs on a computer, and Send to my computer copies the link', async () => {
    userAgent(IPHONE);
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));

    const dialog = await screen.findByRole('dialog', { name: 'Xomoni runs on a computer' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send to my computer' }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(
      await within(dialog).findByText(
        'Link copied. Paste it into a note or a message to yourself, and open it on your computer.',
      ),
    ).toBeInTheDocument();
    expect(services.ask).not.toHaveBeenCalled();
  });

  it('on a phone that refuses the clipboard, offers to email the page’s link, and forgets it once closed', async () => {
    userAgent(IPHONE);
    const writeText = vi.fn(() => Promise.reject(new DOMException('Not allowed', 'NotAllowedError')));
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));

    let dialog = await screen.findByRole('dialog', { name: 'Xomoni runs on a computer' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send to my computer' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Couldn’t share or copy the link here.');
    const email = within(dialog).getByRole('link', { name: 'Email it to yourself' });
    expect(email.getAttribute('href')).toMatch(/^mailto:\?subject=/);
    expect(decodeURIComponent(email.getAttribute('href')!)).toContain(window.location.href);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    dialog = await screen.findByRole('dialog', { name: 'Xomoni runs on a computer' });
    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
    expect(services.ask).not.toHaveBeenCalled();
  });

  it('on a phone with a share sheet, shares the link instead', async () => {
    userAgent(IPHONE);
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, 'share', { value: share, configurable: true });
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Open in Xomoni' }));

    const dialog = await screen.findByRole('dialog', { name: 'Xomoni runs on a computer' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send to my computer' }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: window.location.href }));
    expect(await within(dialog).findByText('Sent. Open the link on your computer.')).toBeInTheDocument();
  });

  it('signed out, or another account: sign in to Xomoni in this browser', async () => {
    link.current = { status: 'signed-out' };
    const { unmount } = render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    let dialog = await screen.findByRole('dialog', { name: 'Sign in to Xomoni in this browser' });
    expect(dialog).toHaveTextContent('isn’t signed in to your account');
    expect(within(dialog).getByRole('link', { name: /Connect this browser/ })).toHaveAttribute(
      'href',
      '/dashboard/browsers',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'I’ve signed in' }));
    expect(await within(dialog).findByText(/still isn’t signed in/)).toBeInTheDocument();
    unmount();

    link.current = { status: 'signed-in', deviceId: OTHER };
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    dialog = await screen.findByRole('dialog', { name: 'Sign in to Xomoni in this browser' });
    expect(dialog).toHaveTextContent('signed in to another xomoni.com account');
    expect(services.ask).not.toHaveBeenCalled();
  });

  it('a click while still looking waits for Xomoni, then goes ahead without a dialog', async () => {
    link.current = { status: 'unknown' };
    const { rerender } = render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    link.current = { status: 'signed-in', deviceId: MINE };
    rerender(<Page />);
    await waitFor(() =>
      expect(services.ask).toHaveBeenCalledWith({ kind: 'job', action: 'pause', jobId: 'job-1', deviceId: MINE }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a click while still looking opens the dialog once the wait is over, which says when Xomoni is ready', async () => {
    link.current = { status: 'unknown' };
    const { rerender } = render(<Page checkWaitMs={200} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('dialog', { name: 'Looking for Xomoni' })).toBeInTheDocument();

    link.current = { status: 'signed-in', deviceId: MINE };
    rerender(<Page checkWaitMs={200} />);
    expect(await screen.findByRole('dialog', { name: 'Xomoni is ready' })).toBeInTheDocument();
    expect(services.ask).not.toHaveBeenCalled();
  });
});

/** A page reading Watch from Xomoni, showing what came back. */
function Reader() {
  const xomoni = useXomoni([MINE], () => services as unknown as XomoniActionServices);
  const { answer, loading, reload } = useXomoniRead(xomoni, { what: 'watch' });
  return (
    <>
      <p>{loading ? 'loading' : answer ? JSON.stringify(answer) : 'nothing'}</p>
      <button onClick={reload}>again</button>
    </>
  );
}

describe('useXomoniRead (ADR-0028, #233)', () => {
  it('reads from Xomoni in this browser, naming the device, and reads again on request', async () => {
    render(<Reader />);
    expect(await screen.findByText('{"ok":true,"what":"watch","tabs":[]}')).toBeInTheDocument();
    expect(services.read).toHaveBeenCalledWith({ what: 'watch', deviceId: MINE });
    await userEvent.click(screen.getByRole('button', { name: 'again' }));
    await waitFor(() => expect(services.read).toHaveBeenCalledTimes(2));
  });

  it('reads nothing while Xomoni isn’t here, or is signed in as another device', () => {
    link.current = { status: 'signed-in', deviceId: OTHER };
    const { unmount } = render(<Reader />);
    expect(screen.getByText('nothing')).toBeInTheDocument();
    unmount();
    link.current = { status: 'none' };
    render(<Reader />);
    expect(screen.getByText('nothing')).toBeInTheDocument();
    expect(services.read).not.toHaveBeenCalled();
  });

  it('keeps nothing it read once Xomoni is gone', async () => {
    const { rerender } = render(<Reader />);
    expect(await screen.findByText(/"what":"watch"/)).toBeInTheDocument();
    link.current = { status: 'signed-out' };
    rerender(<Reader />);
    expect(screen.getByText('nothing')).toBeInTheDocument();
  });

  it('leaves no trace of an answer in storage, and asks no server (ADR-0028)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    localStorage.clear();
    sessionStorage.clear();
    services.read.mockResolvedValue({
      ok: true,
      what: 'watch',
      tabs: [{ query: 'secret words', checkedAt: null, error: '', posts: [] }],
    });
    render(<Reader />);
    expect(await screen.findByText(/secret words/)).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain('secret');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/** A page that turns notifications off through Xomoni, showing its answer. */
function Changer() {
  const xomoni = useXomoni([MINE], () => services as unknown as XomoniActionServices);
  const [answer, setAnswer] = useState('none yet');
  return (
    <>
      <p>{answer}</p>
      <button
        onClick={() => void xomoni.changeSettings({ notifications: false }).then((a) => setAnswer(JSON.stringify(a)))}
      >
        change
      </button>
    </>
  );
}

describe('useXomoni: changing settings (ADR-0029, #234)', () => {
  it('hands the change to Xomoni here, naming its device', async () => {
    render(<Changer />);
    await userEvent.click(screen.getByRole('button', { name: 'change' }));
    expect(await screen.findByText('{"ok":false,"reason":"refused"}')).toBeInTheDocument();
    expect(services.settings).toHaveBeenCalledWith({ deviceId: MINE, change: { notifications: false } });
  });

  it('sends nothing while Xomoni here is signed in to another account', async () => {
    link.current = { status: 'signed-in', deviceId: OTHER };
    render(<Changer />);
    await userEvent.click(screen.getByRole('button', { name: 'change' }));
    expect(await screen.findByText('null')).toBeInTheDocument();
    expect(services.settings).not.toHaveBeenCalled();
  });
});
