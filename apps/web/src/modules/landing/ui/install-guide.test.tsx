// @vitest-environment happy-dom
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOWNLOAD_URL } from '@/shared/config/site';
import { extensionsAddress } from '../domain/install-guide';
import { CopyText, InstallGuide, PhoneNotice, useInstallSteps, usePlatform } from './install-guide';

const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
};

const NAVIGATOR_FIELDS = ['userAgent', 'userAgentData', 'brave', 'maxTouchPoints', 'clipboard'] as const;

/** Makes this test's browser say these things about itself. */
function browser(hints: { userAgent: string; brands?: string[]; platform?: string; brave?: boolean }) {
  const define = (name: string, value: unknown) =>
    Object.defineProperty(window.navigator, name, { value, configurable: true });
  define('userAgent', hints.userAgent);
  if (hints.brands || hints.platform)
    define('userAgentData', {
      brands: (hints.brands ?? []).map((brand) => ({ brand, version: '131' })),
      platform: hints.platform ?? '',
      mobile: false,
    });
  if (hints.brave) define('brave', { isBrave: () => Promise.resolve(true) });
}

/** Stops links from leaving the test page, after React's handlers ran. */
function stayOnPage() {
  const stop = (event: Event) => event.preventDefault();
  document.addEventListener('click', stop);
  return () => document.removeEventListener('click', stop);
}

afterEach(() => {
  for (const name of NAVIGATOR_FIELDS) Reflect.deleteProperty(window.navigator, name);
  vi.restoreAllMocks();
});

/** The guide as /install drives it, in this test's browser. */
function Guide({ installed = false }: { installed?: boolean }) {
  const steps = useInstallSteps(installed);
  return <InstallGuide platform={usePlatform()} steps={steps} />;
}

const guide = () => screen.getByRole('region', { name: 'Install steps' });
const progress = () => within(guide()).getByRole('progressbar');

describe('usePlatform (#299)', () => {
  it('reads the browser and the computer', () => {
    browser({ userAgent: UA.edgeWindows, brands: ['Chromium', 'Microsoft Edge'], platform: 'Windows' });
    expect(renderHook(() => usePlatform()).result.current).toEqual({ browser: 'edge', os: 'windows', phone: false });
  });

  it('tells Brave from Chrome', () => {
    browser({ userAgent: UA.chromeMac, platform: 'macOS', brave: true });
    expect(renderHook(() => usePlatform()).result.current).toEqual({ browser: 'brave', os: 'mac', phone: false });
  });

  it('renders general words on the server, and the browser’s own once hydrated, with no mismatch', async () => {
    function Address() {
      return <p>{extensionsAddress(usePlatform().browser)}</p>;
    }
    browser({ userAgent: UA.edgeWindows, brands: ['Microsoft Edge'], platform: 'Windows' });
    const html = renderToString(<Address />);
    expect(html).toContain('chrome://extensions');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <Address />, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(container).toHaveTextContent('edge://extensions');
    container.remove();
  });
});

describe('InstallGuide, one step at a time (#299)', () => {
  it('starts with the risks, with its progress, and goes forward and back with the focus on each title', async () => {
    const user = userEvent.setup();
    render(<Guide />);

    expect(within(guide()).getByText('Step 1 of 5')).toBeInTheDocument();
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(progress()).toHaveAttribute('aria-valuemax', '5');
    expect(screen.getByRole('heading', { level: 2, name: 'Read what can go wrong' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'the risks' })).toHaveAttribute('href', '/risks');
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(within(guide()).getByText('Step 2 of 5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Download Xomoni' })).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Download xomoni-extension.zip' })).toHaveAttribute('href', DOWNLOAD_URL);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Read what can go wrong' })).toHaveFocus();
  });

  it('moves on to unzipping once the download starts, without stopping the download', async () => {
    const user = userEvent.setup();
    render(<Guide />);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Following the link would leave the test page: stop it here, after React's handler ran, noting whether it had.
    let stopped: boolean | undefined;
    document.addEventListener(
      'click',
      (event) => {
        stopped = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    fireEvent.click(screen.getByRole('link', { name: 'Download xomoni-extension.zip' }));

    expect(within(guide()).getByText('Step 3 of 5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Unzip it into a folder you keep' })).toHaveFocus();
    expect(stopped).toBe(false);
  });

  it('goes to following Xomoni here as soon as Xomoni answers, the steps before it done', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Guide />);
    expect(within(guide()).getByText('Step 1 of 5')).toBeInTheDocument();

    rerender(<Guide installed />);
    expect(within(guide()).getByText('Step 5 of 5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Follow it here (optional)' })).toBeInTheDocument();
    expect(screen.getByText(/Xomoni is installed in this browser\./)).toBeInTheDocument();
    expect(screen.getByText(/Only job status is sent/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    // The automatic move leaves the focus where the person had it.
    expect(document.body).toHaveFocus();

    // Going back is still possible, and doesn't bounce forward again.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: /^Add it to .*: done$/ })).toHaveFocus();
    rerender(<Guide installed />);
    expect(within(guide()).getByText('Step 4 of 5')).toBeInTheDocument();
  });

  it('starts at following Xomoni here when Xomoni already answers', () => {
    render(<Guide installed />);
    expect(within(guide()).getByText('Step 5 of 5')).toBeInTheDocument();
  });
});

describe('InstallGuide, all steps (#299)', () => {
  it('lists every step in order with the current one marked, and goes back to one at a time', async () => {
    const user = userEvent.setup();
    render(<Guide />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Show all steps' }));

    const items = within(guide())
      .getAllByRole('listitem')
      .filter((item) => item.querySelector('h2'));
    expect(items.map((item) => within(item).getByRole('heading', { level: 2 }).textContent)).toEqual([
      'Read what can go wrong',
      'Download Xomoni',
      'Unzip it into a folder you keep',
      'Add it to Chrome, Edge or Brave',
      'Follow it here (optional)',
    ]);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items.filter((item) => item.hasAttribute('aria-current'))).toHaveLength(1);
    expect(within(guide()).queryByRole('progressbar')).not.toBeInTheDocument();

    const allow = stayOnPage();
    fireEvent.click(screen.getByRole('link', { name: 'Download xomoni-extension.zip' }));
    allow();
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('heading', { name: 'Unzip it into a folder you keep' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'One step at a time' }));
    expect(within(guide()).getByText('Step 3 of 5')).toBeInTheDocument();
  });

  it('marks every step that installs Xomoni as done once it answers', async () => {
    const user = userEvent.setup();
    render(<Guide installed />);
    await user.click(screen.getByRole('button', { name: 'Show all steps' }));
    const titles = within(guide())
      .getAllByRole('heading', { level: 2 })
      .map((title) => title.textContent);
    expect(titles).toEqual([
      'Read what can go wrong: done',
      'Download Xomoni: done',
      'Unzip it into a folder you keep: done',
      'Add it to Chrome, Edge or Brave: done',
      'Follow it here (optional)',
    ]);
  });
});

describe('InstallGuide for each browser and computer (#299)', () => {
  /** The guide's "add" step, shown on its own. */
  async function addStep() {
    const user = userEvent.setup();
    render(<Guide />);
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Next' }));
    return guide();
  }

  it('in Edge on Windows: edge://extensions, Developer mode on the left, Extract All', async () => {
    browser({ userAgent: UA.edgeWindows, brands: ['Chromium', 'Microsoft Edge'], platform: 'Windows' });
    const user = userEvent.setup();
    render(<Guide />);
    await user.click(screen.getByRole('button', { name: 'Show all steps' }));

    expect(screen.getByText(/Right-click xomoni-extension\.zip.*Extract All…/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add it to Edge' })).toBeInTheDocument();
    expect(screen.getByText('edge://extensions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy edge://extensions' })).toBeInTheDocument();
    expect(screen.getByText(/in the panel on the left/)).toBeInTheDocument();
  });

  it('in Brave on a Mac: brave://extensions, Developer mode at the top right, double-click to unzip', async () => {
    browser({ userAgent: UA.chromeMac, brands: ['Chromium', 'Brave'], platform: 'macOS', brave: true });
    const user = userEvent.setup();
    render(<Guide />);
    await user.click(screen.getByRole('button', { name: 'Show all steps' }));

    expect(screen.getByText(/^Double-click xomoni-extension\.zip/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add it to Brave' })).toBeInTheDocument();
    expect(screen.getByText('brave://extensions')).toBeInTheDocument();
    expect(screen.getByText(/at the top right/)).toBeInTheDocument();
  });

  it('in Chrome: chrome://extensions; dragging the folder first, Load unpacked second', async () => {
    browser({ userAgent: UA.chromeMac, brands: ['Chromium', 'Google Chrome'], platform: 'macOS' });
    const step = await addStep();

    expect(within(step).getByRole('heading', { name: 'Add it to Chrome' })).toHaveFocus();
    expect(within(step).getByText('chrome://extensions')).toBeInTheDocument();
    expect(step).toHaveTextContent('Turn on Developer mode, at the top right.');
    const ways = within(step).getAllByRole('listitem');
    expect(ways.map((way) => way.textContent)).toEqual([
      'Drag the folder onto the extensions page and drop it there.',
      'Or choose Load unpacked and select the folder.',
    ]);
  });

  it('says first when the browser can’t run Xomoni', () => {
    browser({ userAgent: UA.firefoxWindows });
    render(<Guide />);
    expect(within(guide()).getByText('This browser can’t run Xomoni.')).toBeInTheDocument();
    expect(guide()).toHaveTextContent('Open this page in Chrome, Edge or Brave on your computer to install it.');
  });

  it('says nothing of the kind in a browser that can', () => {
    browser({ userAgent: UA.chromeMac, brands: ['Google Chrome'], platform: 'macOS' });
    render(<Guide />);
    expect(screen.queryByText('This browser can’t run Xomoni.')).not.toBeInTheDocument();
  });
});

describe('CopyText (#299)', () => {
  it('copies the address and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CopyText text="edge://extensions" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy edge://extensions' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Copied');
    expect(writeText).toHaveBeenCalledWith('edge://extensions');
  });

  it('asks to copy it by hand when the browser refuses the clipboard', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CopyText text="chrome://extensions" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy chrome://extensions' }));

    expect(await screen.findByText('Couldn’t copy: select it and copy it yourself')).toBeInTheDocument();
  });

  it('says nothing before it is pressed', () => {
    render(<CopyText text="chrome://extensions" />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('PhoneNotice (#299)', () => {
  it('says Xomoni runs on a computer and gives the link to open there, with nothing to download', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<PhoneNotice />);

    const notice = screen.getByRole('region', { name: 'Xomoni runs on a computer' });
    expect(notice).toHaveTextContent('Phones and tablets can’t run it.');
    expect(within(notice).queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(within(notice).getByRole('button', { name: 'Copy http://localhost:3000/install' }));
    expect(await within(notice).findByRole('status')).toHaveTextContent('Copied');
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/install');
  });
});
