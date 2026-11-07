// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device } from '../domain/model';
import type { PairingResult } from '../domain/pairing';
import { PairingPanel } from './pairing-panel';

const NOW = Date.UTC(2026, 10, 2, 12);

describe('PairingPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const user = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });

  it('makes a code on request and shows it with its countdown', async () => {
    const createCode = vi.fn<() => Promise<PairingResult>>().mockResolvedValue({
      ok: true,
      code: { code: 'AB2CD-EF3GH', expiresAt: new Date(NOW + 600_000).toISOString() },
    });
    render(<PairingPanel createCode={createCode} />);

    await user().click(screen.getByRole('button', { name: 'Get a code to connect a browser' }));
    expect(await screen.findByLabelText('Pairing code')).toHaveTextContent('AB2CD-EF3GH');
    expect(screen.getByRole('timer')).toHaveTextContent('Works once, for 10:00 more.');

    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByRole('timer')).toHaveTextContent('Works once, for 8:55 more.');
    expect(createCode).toHaveBeenCalledOnce();
  });

  it('offers a new code once the code expired, and never shows an expired one', async () => {
    const createCode = vi.fn<() => Promise<PairingResult>>().mockResolvedValue({
      ok: true,
      code: { code: 'AB2CD-EF3GH', expiresAt: new Date(NOW + 2_000).toISOString() },
    });
    render(<PairingPanel createCode={createCode} />);
    await user().click(screen.getByRole('button', { name: 'Get a code to connect a browser' }));
    await screen.findByLabelText('Pairing code');

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: 'The code expired. Get a new one' }));
    expect(createCode).toHaveBeenCalledTimes(2);
  });

  it('says why there is no code', async () => {
    const createCode = vi
      .fn<() => Promise<PairingResult>>()
      .mockResolvedValue({ ok: false, message: 'Sign in first.' });
    render(<PairingPanel createCode={createCode} />);
    await user().click(screen.getByRole('button', { name: 'Get a code to connect a browser' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in first.');
    expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument();
  });

  describe('the link while a code waits, and once a browser uses it (#182)', () => {
    const laptop: Device = {
      id: 'd1',
      name: 'Chrome on macOS',
      extensionVersion: '0.2.0',
      lastSeenAt: new Date(NOW).toISOString(),
    };
    const desktop: Device = { ...laptop, id: 'd2', name: 'Edge on Windows' };
    const codeOk = () =>
      vi.fn<() => Promise<PairingResult>>().mockResolvedValue({
        ok: true,
        code: { code: 'AB2CD-EF3GH', expiresAt: new Date(NOW + 600_000).toISOString() },
      });

    it('says it is waiting for the browser while the code is shown', async () => {
      render(<PairingPanel createCode={codeOk()} devices={[laptop]} />);
      await user().click(screen.getByRole('button', { name: 'Get a code to connect a browser' }));

      expect(await screen.findByRole('status')).toHaveTextContent('Waiting for your browser to connect…');
      expect(document.querySelector('[data-state="waiting"]')).not.toBeNull();
    });

    it('gives way to the browser that used the code, named, with a live link and a way to connect another', async () => {
      const createCode = codeOk();
      const { rerender } = render(<PairingPanel createCode={createCode} devices={[laptop]} />);
      await user().click(screen.getByRole('button', { name: 'Get a code to connect a browser' }));
      await screen.findByLabelText('Pairing code');

      // The browser already there before the code doesn't count; the one that appears after does.
      rerender(<PairingPanel createCode={createCode} devices={[laptop]} />);
      expect(screen.getByLabelText('Pairing code')).toBeInTheDocument();
      rerender(<PairingPanel createCode={createCode} devices={[desktop, laptop]} />);

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Edge on Windows is connected. Its jobs show here live.',
      );
      expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument();
      expect(document.querySelector('[data-state="connected"]')).not.toBeNull();

      await user().click(screen.getByRole('button', { name: 'Connect another browser' }));
      expect(await screen.findByLabelText('Pairing code')).toBeInTheDocument();
      expect(createCode).toHaveBeenCalledTimes(2);
    });
  });
});
