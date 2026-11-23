import { HOUR_ENV, NIGHT_ENV, NIGHT_HOURS, OFFSETS, runAtNight, zoneForHours } from '../support/time-of-day';
import { expect, test } from '../support/extension';

// The extension's tests run at night, local time (#414), outside Xomoni's active hours (8:00 to 23:00 by default), so a
// test that starts a job without turning them off (`workAnyTime`) fails in every run, not only in those that fall at
// night by the clock. The browser, its service worker and the test agree on the time.

test.describe('the time of day the extension’s tests run at (#414)', () => {
  test('is a night hour whatever the hour in UTC, within the offsets that keep the fixtures’ days', () => {
    for (let utc = 0; utc < 24; utc++) {
      const now = Date.UTC(2026, 10, 23, utc, 30);
      const at = zoneForHours(NIGHT_HOURS, now);
      expect(at, `at ${String(utc)}:30 UTC`).not.toBeNull();
      const offset = (((at!.hour - utc) % 24) + 24) % 24;
      const signed = offset > 12 ? offset - 24 : offset;
      expect(signed).toBeGreaterThanOrEqual(OFFSETS.min);
      expect(signed).toBeLessThanOrEqual(OFFSETS.max);
      const local = new Date(now).toLocaleString('en-GB', { timeZone: at!.zone, hour: '2-digit', hourCycle: 'h23' });
      expect(Number(local)).toBe(at!.hour);
    }
  });

  test('keeps a zone a person chose, and takes another hour when asked', () => {
    const chosen: Record<string, string | undefined> = { TZ: 'Asia/Tehran' };
    expect(runAtNight(chosen, Date.UTC(2026, 10, 23, 12))).toBe('Asia/Tehran');
    expect(chosen[NIGHT_ENV]).toBeUndefined();
    const unset: Record<string, string | undefined> = {};
    expect(runAtNight(unset, Date.UTC(2026, 10, 23, 12))).toBe('Etc/GMT+9');
    expect(unset[NIGHT_ENV]).toBe('1');
    const env: Record<string, string | undefined> = { [HOUR_ENV]: '14' };
    expect(runAtNight(env, Date.UTC(2026, 10, 23, 12))).toBe('Etc/GMT-2');
    expect(() => runAtNight({ [HOUR_ENV]: '25' })).toThrow(`${HOUR_ENV}=25: give an hour, 0 to 23`);
  });

  test('is the same in the test, the dashboard and the service worker, outside the default active hours', async ({
    dashboard,
    serviceWorker,
  }) => {
    test.skip(!process.env[NIGHT_ENV], 'this run keeps a time zone or an hour a person chose');
    const here = new Date().getHours();
    expect(NIGHT_HOURS as readonly number[]).toContain(here);
    const page = await dashboard.evaluate(() => ({
      hour: new Date().getHours(),
      offset: new Date().getTimezoneOffset(),
    }));
    const worker = await serviceWorker.evaluate(() => new Date().getHours());
    // Within the hour: the test may run across the turn of one.
    expect([here, (here + 1) % 24]).toContain(page.hour);
    expect([here, (here + 1) % 24]).toContain(worker);
    expect(page.offset).toBe(new Date().getTimezoneOffset());
    // The default active hours, 8:00 to 23:00, are hours away on either side.
    expect(page.hour).toBeGreaterThanOrEqual(2);
    expect(page.hour).toBeLessThan(8);
  });
});
