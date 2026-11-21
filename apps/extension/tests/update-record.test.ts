import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { kvSet } from '../src/shared/db';
import {
  REOPEN_WITHIN_MS,
  UPDATE_RECORD_KEY,
  recentUpdate,
  recordUpdate,
  takeUpdateRecord,
} from '../src/shared/update-record';
import { resetDb } from './support/fixtures';

const AT = 1_800_000_000_000;

describe('the record a one-click update leaves for after the reload (#305)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('is recent for the service worker for ten minutes, and stays for the dashboard', async () => {
    expect(await recentUpdate(AT)).toBeNull();
    await recordUpdate({ from: '0.4.0', to: '0.5.0', at: AT });
    expect(await recentUpdate(AT + REOPEN_WITHIN_MS)).toEqual({ from: '0.4.0', to: '0.5.0', at: AT });
    expect(await recentUpdate(AT)).not.toBeNull();
    // A reload long after, or a clock set back, is not this update's.
    expect(await recentUpdate(AT + REOPEN_WITHIN_MS + 1)).toBeNull();
    expect(await recentUpdate(AT - 1)).toBeNull();
  });

  it('is taken once, by the first dashboard that asks', async () => {
    await recordUpdate({ from: '0.4.0', to: '0.5.0', at: AT });
    const [first, second] = await Promise.all([takeUpdateRecord(), takeUpdateRecord()]);
    expect([first, second].filter(Boolean)).toEqual([{ from: '0.4.0', to: '0.5.0', at: AT }]);
    expect(await takeUpdateRecord()).toBeNull();
    expect(await recentUpdate(AT)).toBeNull();
  });

  it('is ignored when it isn’t a record, and forgotten all the same', async () => {
    for (const value of ['0.5.0', { from: '0.4.0', to: 'v0.5.0', at: AT }, { from: '0.4.0', to: '0.5.0' }, null]) {
      await kvSet(UPDATE_RECORD_KEY, value);
      expect(await recentUpdate(AT)).toBeNull();
      expect(await takeUpdateRecord()).toBeNull();
    }
  });
});
