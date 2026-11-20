import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CloudConnection, clearConnection, saveConnection } from '../src/cloud/connection';
import { accessRefusal } from '../src/cloud/website-access';
import { markSignedOut } from '../src/shared/session';
import { stubChrome } from './support/chrome';
import { resetDb } from './support/fixtures';

const DEVICE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const CONNECTED: CloudConnection = {
  deviceId: DEVICE,
  token: 'tok',
  deviceName: 'Chrome',
  connectedAt: 1,
  reportedUpTo: 0,
  account: 'a•••@example.com',
  confirmed: true,
};

beforeEach(async () => {
  stubChrome();
  await resetDb();
  await saveConnection(CONNECTED);
});
afterEach(() => vi.unstubAllGlobals());

describe('accessRefusal: who xomoni.com may act or read for (ADR-0027, ADR-0028)', () => {
  it('lets a page in that names this device, whatever the case of its id', async () => {
    expect(await accessRefusal(DEVICE)).toBeNull();
    expect(await accessRefusal(DEVICE.toUpperCase())).toBeNull();
  });

  it('refuses a page that names another device', async () => {
    expect(await accessRefusal('9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f')).toBe('other_account');
  });

  it('refuses while signed out of Xomoni, even for this device', async () => {
    await markSignedOut('me', true);
    expect(await accessRefusal(DEVICE)).toBe('signed_out');
  });

  it('refuses while this browser isn’t connected to xomoni.com', async () => {
    await clearConnection();
    expect(await accessRefusal(DEVICE)).toBe('not_connected');
  });
});
