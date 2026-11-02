// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConnection, saveConnection } from '../../src/cloud/connection';
import { CloudCard, suggestedDeviceName } from '../../src/ui/components/CloudCard';
import { stubChrome } from '../support/chrome';
import { resetDb } from '../support/fixtures';

type Fetch = Mock<(url: string, init?: RequestInit) => Promise<Response>>;
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));

describe('Settings: the xomoni.com card (ADR-0018)', () => {
  let fetch: Fetch;
  beforeEach(async () => {
    stubChrome();
    fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => json(204, null));
    vi.stubGlobal('fetch', fetch);
    await resetDb();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says what is sent, links to where codes are made, and connects with a code', async () => {
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd1', token: 'secret' }]));
    render(<CloudCard />);

    expect(screen.getByText(/never what you posted or liked/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Get a code/ })).toHaveAttribute(
      'href',
      'https://xomoni.com/dashboard',
    );
    const connectButton = screen.getByRole('button', { name: 'Connect' });
    expect(connectButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Code'), 'ab2cd-ef3gh');
    await userEvent.clear(screen.getByLabelText('This browser’s name'));
    await userEvent.type(screen.getByLabelText('This browser’s name'), 'Work laptop');
    await userEvent.click(connectButton);

    expect(await screen.findByText(/Connected as/)).toHaveTextContent('Connected as Work laptop since');
    expect(await getConnection()).toMatchObject({ deviceId: 'd1', deviceName: 'Work laptop' });
  });

  it('shows why a code was refused, and stays disconnected', async () => {
    fetch.mockReturnValueOnce(
      json(400, { message: 'This code is not valid. Get a new one on xomoni.com.', hint: 'bad_code' }),
    );
    render(<CloudCard />);
    await userEvent.type(await screen.findByLabelText('Code'), 'AAAAAAAAAA');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This code is not valid. Get a new one on xomoni.com.');
    expect(await getConnection()).toBeNull();
  });

  it('disconnects a connected browser', async () => {
    await saveConnection({
      deviceId: 'd1',
      token: 't',
      deviceName: 'Chrome on macOS',
      connectedAt: Date.now(),
      reportedUpTo: 0,
    });
    render(<CloudCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));

    await waitFor(async () => expect(await getConnection()).toBeNull());
    expect(await screen.findByLabelText('Code')).toBeInTheDocument();
    expect(fetch.mock.calls.at(-1)?.[0]).toMatch(/unpair_device$/);
  });

  it('suggests a name from the browser and the system', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/156.0 Safari/537.36';
    expect(suggestedDeviceName(mac)).toBe('Chrome on macOS');
    expect(suggestedDeviceName('Mozilla/5.0 (Windows NT 10.0) Chrome/156.0 Edg/156.0')).toBe('Edge on Windows');
    expect(suggestedDeviceName('Mozilla/5.0 (X11; Linux x86_64) Chrome/156.0')).toBe('Chrome on Linux');
    expect(suggestedDeviceName('Mozilla/5.0 (X11; CrOS x86_64) Chrome/156.0')).toBe('Chrome on ChromeOS');
    expect(suggestedDeviceName('Something else')).toBe('Chrome');
  });
});
