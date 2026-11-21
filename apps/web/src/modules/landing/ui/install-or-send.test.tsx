// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INSTALL_PAGE_URL } from '@/shared/config/site';
import { InstallOrSend } from './install-or-send';

const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};

const define = (name: string, value: unknown) =>
  Object.defineProperty(window.navigator, name, { value, configurable: true });

afterEach(() => {
  for (const name of ['userAgent', 'share', 'clipboard']) Reflect.deleteProperty(window.navigator, name);
});

function Action() {
  return (
    <InstallOrSend align="center">
      <a href="/install">Get the extension</a>
    </InstallOrSend>
  );
}

describe('InstallOrSend (#243)', () => {
  it('keeps the install button on a computer, with nothing to send', () => {
    define('userAgent', UA.chromeMac);
    render(<Action />);

    expect(screen.getByRole('link', { name: 'Get the extension' })).toHaveAttribute('href', '/install');
    expect(screen.queryByRole('button', { name: 'Send to my computer' })).not.toBeInTheDocument();
  });

  it('on a phone, sends the install guide’s address to the computer instead of offering to install', async () => {
    define('userAgent', UA.iphone);
    const share = vi.fn(() => Promise.resolve());
    define('share', share);
    render(<Action />);

    expect(screen.queryByRole('link', { name: 'Get the extension' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send to my computer' }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: INSTALL_PAGE_URL }));
    expect(INSTALL_PAGE_URL).toBe('http://localhost:3000/install');
  });

  it('on an Android phone without a share sheet, copies the address', async () => {
    define('userAgent', UA.android);
    const writeText = vi.fn(() => Promise.resolve());
    define('clipboard', { writeText });
    render(<Action />);

    await userEvent.click(screen.getByRole('button', { name: 'Send to my computer' }));
    expect(writeText).toHaveBeenCalledWith(INSTALL_PAGE_URL);
    expect(await screen.findByRole('status')).toHaveTextContent('Link copied.');
  });

  it('renders the computer’s button on the server, and Send to my computer once a phone hydrates, with no mismatch', async () => {
    define('userAgent', UA.iphone);
    define('clipboard', { writeText: vi.fn(() => Promise.resolve()) });
    const html = renderToString(<Action />);
    expect(html).toContain('Get the extension');
    expect(html).not.toContain('Send to my computer');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <Action />, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(container).not.toHaveTextContent('Get the extension');
    expect(container.querySelector('button')).toHaveTextContent('Send to my computer');
    container.remove();
  });
});
