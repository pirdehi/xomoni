// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
    // Unmount first: a component's pending effect must not run against removed stubs or mocks.
    cleanup();
    vi.unstubAllGlobals();
  });

  it('says what is sent, links to where codes are made, and connects with a code', async () => {
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd1', token: 'secret', account: 'o•••@example.com' }]));
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

    // Nothing is sent until the person says the account is theirs (#149).
    const question = await screen.findByRole('group', { name: 'Confirm the account' });
    expect(question).toHaveTextContent('linked this browser to the xomoni.com account o•••@example.com');
    expect(fetch.mock.calls.map(([url]) => url.split('/').pop())).toEqual(['pair_device']);
    await userEvent.click(screen.getByRole('button', { name: 'Yes, it’s mine' }));

    expect(await screen.findByText(/Connected as/)).toHaveTextContent(
      'Connected as Work laptop to o•••@example.com since',
    );
    expect(await getConnection()).toMatchObject({ deviceId: 'd1', deviceName: 'Work laptop', confirmed: true });
    await waitFor(() => expect(fetch.mock.calls.at(-1)?.[0]).toMatch(/device_report$/));
  });

  it('disconnects at once when the account isn’t the person’s, having sent nothing (#149)', async () => {
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd1', token: 'secret', account: 'z•••@attacker.example' }]));
    render(<CloudCard />);
    await userEvent.type(await screen.findByLabelText('Code'), 'ab2cd-ef3gh');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await userEvent.click(await screen.findByRole('button', { name: 'No, disconnect' }));

    await waitFor(async () => expect(await getConnection()).toBeNull());
    expect(fetch.mock.calls.map(([url]) => url.split('/').pop())).toEqual(['pair_device', 'unpair_device']);
  });

  it('shows why a code was refused, and stays disconnected', async () => {
    fetch.mockReturnValueOnce(
      json(400, { message: 'This code is not valid. Get a new one on xomoni.com.', hint: 'bad_code' }),
    );
    render(<CloudCard />);
    await userEvent.type(await screen.findByLabelText('Code'), 'AAAAAAAAAA');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This code is not valid. Get a new one on xomoni.com.');
    expect(alert).toHaveAttribute('data-tone', 'critical');
    expect(await getConnection()).toBeNull();
  });

  it('disconnects a connected browser', async () => {
    await saveConnection({
      deviceId: 'd1',
      token: 't',
      deviceName: 'Chrome on macOS',
      connectedAt: Date.now(),
      reportedUpTo: 0,
      account: 'o•••@example.com',
      confirmed: true,
    });
    render(<CloudCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));

    await waitFor(async () => expect(await getConnection()).toBeNull());
    expect(await screen.findByLabelText('Code')).toBeInTheDocument();
    expect(fetch.mock.calls.at(-1)?.[0]).toMatch(/unpair_device$/);
  });

  it('tells the person to remove the browser on the website when it couldn’t be told (#151)', async () => {
    await saveConnection({
      deviceId: 'd1',
      token: 't',
      deviceName: 'Chrome on macOS',
      connectedAt: 1,
      reportedUpTo: 0,
      account: 'o•••@example.com',
      confirmed: true,
    });
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<CloudCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('remove it under Connected browsers on xomoni.com');
    expect(await getConnection()).toBeNull();
  });

  it('draws the link to xomoni.com as it stands: none, waiting for the person, then live (#182)', async () => {
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd1', token: 'secret', account: 'o•••@example.com' }]));
    render(<CloudCard x="signed-in" />);
    const map = () => screen.getByRole('img');
    await waitFor(() => expect(map()).toHaveAttribute('data-cloud', 'off'));
    expect(map()).toHaveAttribute('data-x', 'signed-in');

    await userEvent.type(await screen.findByLabelText('Code'), 'ab2cd-ef3gh');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(map()).toHaveAttribute('data-cloud', 'pending'));

    await userEvent.click(await screen.findByRole('button', { name: 'Yes, it’s mine' }));
    await waitFor(() => expect(map()).toHaveAttribute('data-cloud', 'connected'));
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
