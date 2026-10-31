import 'fake-indexeddb/auto';
import { CONSENT_VERSION } from '@xomoni/consent';
import { beforeEach, describe, expect, it } from 'vitest';
import { JobContext, Stop } from '../src/engine/context';
import { db, hasConsent, recordConsent } from '../src/shared/db';
import type { Job } from '../src/shared/types';

const ACCOUNT = 'acct-1';
const context = () =>
  new JobContext({ id: 'j', accountId: ACCOUNT } as Job, new AbortController().signal, {
    status: () => {},
    attention: () => {},
  });

beforeEach(async () => {
  await Promise.all([db.consents.clear(), db.risk.clear()]);
});

describe('informed consent (#24, PLAYBOOK C7)', () => {
  it('is stored per X account with the version of the text', async () => {
    expect(await hasConsent(ACCOUNT)).toBe(false);
    await recordConsent(ACCOUNT);
    expect(await hasConsent(ACCOUNT)).toBe(true);
    expect(await hasConsent('another-account')).toBe(false);
    expect(await db.consents.get(ACCOUNT)).toMatchObject({ version: CONSENT_VERSION });
  });

  it('is asked again when the text has a newer version', async () => {
    await db.consents.put({ accountId: ACCOUNT, version: CONSENT_VERSION - 1, at: Date.now() });
    expect(await hasConsent(ACCOUNT)).toBe(false);
  });

  it('is required before a run touches X', async () => {
    const err = await context()
      .init()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Stop);
    expect((err as Stop).state).toBe('blocked');
    expect((err as Stop).message).toMatch(/I UNDERSTAND/);

    await recordConsent(ACCOUNT);
    await expect(context().init()).resolves.toBeUndefined();
  });
});
