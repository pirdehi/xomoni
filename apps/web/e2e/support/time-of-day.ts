// The local time the extension's browser tests run at (#414). Xomoni works only within the person's active hours,
// 8:00 to 23:00 by default, by the computer's clock, so a test that starts a job and forgets to turn them off
// (`workAnyTime`) would pass by day and time out at night: in CI's runs that happen to fall at night, the nightly
// among them. The extension's tests run at night, local time, in every run instead, so such a test fails every time,
// in the pull request that adds it.

/** The environment variable that names another local hour to run at (0 to 23), such as 14 to try the day. */
export const HOUR_ENV = 'XOMONI_E2E_HOUR';

/** Set by `runAtNight` when it chose the night for this run, rather than keeping a `TZ` or an hour a person asked for. */
export const NIGHT_ENV = 'XOMONI_E2E_AT_NIGHT';

/** Local hours of the night the tests run at, in order of preference: well clear of 8:00 and 23:00 on both sides. */
export const NIGHT_HOURS = [3, 4, 2, 5, 6] as const;

/**
 * The offsets from UTC allowed, in hours: the fixtures date X's posts between 09:26 and 12:00 UTC, and an offset
 * beyond these would show some of them on another day than the specs expect.
 */
export const OFFSETS = { min: -9, max: 11 } as const;

/** A time zone of a whole number of hours from UTC (`Etc/GMT-3` is three hours ahead of UTC: POSIX signs are reversed). */
export function zoneAt(offset: number): string {
  return offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${String(Math.abs(offset))}`;
}

/**
 * The time zone in which it is one of `hours` now (the first that can be), within `OFFSETS`, with that hour; null when
 * none can be. Etc/GMT zones keep no daylight saving, so the hour stays put for the whole run.
 */
export function zoneForHours(hours: readonly number[], now = Date.now()): { zone: string; hour: number } | null {
  const utcHour = new Date(now).getUTCHours();
  for (const hour of hours) {
    let offset = (((hour - utcHour) % 24) + 24) % 24;
    if (offset > 12) offset -= 24;
    if (offset >= OFFSETS.min && offset <= OFFSETS.max) return { zone: zoneAt(offset), hour };
  }
  return null;
}

/**
 * Sets `TZ` for this run, the test workers and the browsers they launch, which all inherit it: one of `NIGHT_HOURS`,
 * or the hour `XOMONI_E2E_HOUR` names. A `TZ` already set is kept, so a person can still choose any zone.
 */
export function runAtNight(
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): string | undefined {
  const asked = env[HOUR_ENV];
  if (asked !== undefined && asked !== '') {
    const hour = Number(asked);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23)
      throw new Error(`${HOUR_ENV}=${asked}: give an hour, 0 to 23`);
    const at = zoneForHours([hour], now);
    if (!at)
      throw new Error(
        `${HOUR_ENV}=${asked}: no zone within UTC${String(OFFSETS.min)} to +${String(OFFSETS.max)} has it now`,
      );
    env.TZ = at.zone;
  } else if (!env.TZ) {
    // NIGHT_HOURS spans five hours: whatever the hour in UTC, at least one of them is within OFFSETS.
    const zone = zoneForHours(NIGHT_HOURS, now)?.zone;
    if (zone) {
      env.TZ = zone;
      env[NIGHT_ENV] = '1';
    }
  }
  return env.TZ;
}
