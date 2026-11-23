import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSettings, kvGet, updateSettings } from '../src/shared/db';
import { DEFAULT_SETTINGS, PRESETS } from '../src/shared/settings';
import type { Settings } from '../src/shared/types';
import { resetDb } from './support/fixtures';

beforeEach(async () => {
  await resetDb();
});

describe('updateSettings (#427)', () => {
  it('applies each change to the settings as stored, so two changes at once both land', async () => {
    await Promise.all([
      updateSettings((s) => ({ ...s, activeHours: { ...s.activeHours, start: 10 } })),
      updateSettings((s) => ({ ...s, activeHours: { ...s.activeHours, end: 18 } })),
      updateSettings((s) => ({ ...s, notifications: false })),
    ]);
    expect((await getSettings()).activeHours).toEqual({ enabled: true, start: 10, end: 18 });
    expect((await getSettings()).notifications).toBe(false);
  });

  it('gives each change the settings the one before it stored', async () => {
    const seen: number[] = [];
    await Promise.all(
      [1, 2, 3].map(() =>
        updateSettings((s) => {
          seen.push(s.activeHours.start);
          return { ...s, activeHours: { ...s.activeHours, start: s.activeHours.start + 1 } };
        }),
      ),
    );
    const start = DEFAULT_SETTINGS.activeHours.start;
    expect(seen).toEqual([start, start + 1, start + 2]);
    expect((await getSettings()).activeHours.start).toBe(start + 3);
  });

  it('stores the change back inside the safety rules, and resolves to what it stored', async () => {
    const faster = Object.fromEntries(
      Object.entries(PRESETS.careful).map(([action, rule]) => [action, { ...rule, hourlyCap: 10_000, minDelay: 0 }]),
    ) as Settings['pacing'];
    const stored = await updateSettings((s) => ({ ...s, preset: 'custom', pacing: faster }));
    expect(stored.pacing.delete.hourlyCap).toBeLessThanOrEqual(PRESETS.careful.delete.hourlyCap * 2);
    expect(stored.pacing.delete.hourlyCap).toBeLessThan(10_000);
    expect(await kvGet<Settings | null>('settings', null)).toEqual(stored);
  });

  it('stores nothing when the change fails, and rejects with its error', async () => {
    await updateSettings((s) => ({ ...s, notifications: false }));
    await expect(
      updateSettings(() => {
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    expect((await getSettings()).notifications).toBe(false);
  });
});
