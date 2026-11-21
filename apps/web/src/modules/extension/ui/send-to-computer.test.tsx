// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEND_RESULT_TEXT, mailtoHref } from '../domain/send-to-computer';
import { SendToComputer } from './send-to-computer';

const LINK = 'http://localhost:3000/install';

/** Gives this test's browser a share sheet, a clipboard, both or neither (`undefined` takes one away). */
function browserWith({
  share,
  canShare,
  writeText,
}: {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  writeText?: (text: string) => Promise<void>;
}) {
  const define = (name: string, value: unknown) =>
    Object.defineProperty(window.navigator, name, { value, configurable: true });
  define('share', share);
  define('canShare', canShare);
  define('clipboard', writeText ? { writeText } : undefined);
}

/** A share sheet closed by the person, as browsers report it. */
const closed = () => Promise.reject(new DOMException('Share canceled', 'AbortError'));
/** A share sheet or clipboard the browser refuses here. */
const refused = () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));

const button = () => screen.getByRole('button', { name: 'Send to my computer' });

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.reject(new Error('no network in this test')));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  for (const name of ['share', 'canShare', 'clipboard']) Reflect.deleteProperty(window.navigator, name);
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('SendToComputer (#243)', () => {
  it('opens the share sheet with the link as given, and says it was sent', async () => {
    const share = vi.fn(() => Promise.resolve());
    const writeText = vi.fn(() => Promise.resolve());
    browserWith({ share, writeText });
    render(<SendToComputer url={LINK} />);

    await userEvent.click(button());
    expect(share).toHaveBeenCalledWith({ title: 'Xomoni', text: 'Open Xomoni on my computer', url: LINK });
    expect(await screen.findByRole('status')).toHaveTextContent(SEND_RESULT_TEXT.shared);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('says nothing and tries nothing else when the person closes the share sheet', async () => {
    const share = vi.fn(closed);
    const writeText = vi.fn(() => Promise.resolve());
    browserWith({ share, writeText });
    render(<SendToComputer url={LINK} />);

    await userEvent.click(button());
    expect(share).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('copies the link when the browser refuses the share sheet', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    browserWith({ share: vi.fn(refused), writeText });
    render(<SendToComputer url={LINK} />);

    await userEvent.click(button());
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(await screen.findByRole('status')).toHaveTextContent(SEND_RESULT_TEXT.copied);
  });

  it('copies the link where the share sheet can’t take it', async () => {
    const share = vi.fn(() => Promise.resolve());
    const writeText = vi.fn(() => Promise.resolve());
    browserWith({ share, canShare: () => false, writeText });
    render(<SendToComputer url={LINK} />);

    await userEvent.click(button());
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(LINK);
  });

  it('copies the link without a share sheet, and says to open it on the computer', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    browserWith({ writeText });
    render(<SendToComputer url={LINK} />);

    await userEvent.click(button());
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Link copied. Paste it into a note or a message to yourself, and open it on your computer.',
    );
  });

  it('offers the email to oneself when the browser refuses the clipboard', async () => {
    browserWith({ writeText: vi.fn(refused) });
    render(<SendToComputer url={LINK} />);

    await userEvent.click(button());
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(`${SEND_RESULT_TEXT.email} Email it to yourself`);
    expect(screen.getByRole('link', { name: 'Email it to yourself' })).toHaveAttribute('href', mailtoHref(LINK));
  });

  it('goes from a refused share sheet past a refused clipboard to the email', async () => {
    const writeText = vi.fn(refused);
    browserWith({ share: vi.fn(refused), writeText });
    render(<SendToComputer url={LINK} />);

    await userEvent.click(button());
    expect(writeText).toHaveBeenCalledOnce();
    expect(await screen.findByRole('link', { name: 'Email it to yourself' })).toHaveAttribute('href', mailtoHref(LINK));
  });

  it('is an email link from the start where the browser can neither share nor copy', () => {
    browserWith({});
    render(<SendToComputer url={LINK} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Send to my computer' });
    expect(link).toHaveAttribute('href', mailtoHref(LINK));
    expect(link).toHaveAttribute('data-appearance', 'primary');
  });

  it('sends nothing to a server and keeps nothing in the browser', async () => {
    browserWith({ share: vi.fn(refused), writeText: vi.fn(() => Promise.resolve()) });
    render(<SendToComputer url={LINK} />);

    await userEvent.click(button());
    await screen.findByText(SEND_RESULT_TEXT.copied);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
    expect(document.cookie).toBe('');
  });

  it('can be as large as the site’s large calls to action', () => {
    browserWith({ writeText: vi.fn(() => Promise.resolve()) });
    render(<SendToComputer url={LINK} size="large" align="center" />);
    expect(button()).toBeInTheDocument();
  });

  it('renders the email link on the server, which works before any script, and the browser’s way once hydrated', async () => {
    browserWith({ writeText: vi.fn(() => Promise.resolve()) });
    const html = renderToString(<SendToComputer url={LINK} />);
    expect(html).toContain('href="mailto:?subject=');
    expect(html).not.toContain('<button');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <SendToComputer url={LINK} />, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(container.querySelector('button')).toHaveTextContent('Send to my computer');
    expect(container.querySelector('a')).toBeNull();
    container.remove();
  });
});
