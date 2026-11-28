import { asArray, asNumber, asObject, asString } from './json';

/** Accounts on the site, as `admin_overview()` counts them. */
export interface AccountCounts {
  /** Every account. */
  readonly total: number;
  /** Accounts whose email is confirmed. */
  readonly confirmed: number;
  /** Accounts created in the last 7 days. */
  readonly new7d: number;
  /** Accounts created in the last 30 days. */
  readonly new30d: number;
  /** Accounts that signed in during the last 30 days. */
  readonly signedIn30d: number;
  /** Accounts with an authenticator app. */
  readonly withMfa: number;
  /** Suspended accounts. */
  readonly banned: number;
}

/** The console's overview (#516): accounts, browsers, jobs, plans, emails and sign-ups per day. */
export interface Overview {
  /** Accounts. */
  readonly users: AccountCounts;
  /** Browsers with Xomoni connected to an account. */
  readonly devices: {
    readonly total: number;
    readonly active7d: number;
    /** How many browsers run each version of Xomoni, most first. */
    readonly versions: readonly { readonly version: string; readonly devices: number }[];
  };
  /** Jobs the extensions reported. */
  readonly jobs: {
    readonly total: number;
    readonly running: number;
    readonly waiting: number;
    readonly finished7d: number;
  };
  /** Accounts per plan tier. */
  readonly plans: readonly { readonly tier: string; readonly accounts: number }[];
  /** People who chose the weekly email, and the email when X warns an account. */
  readonly emails: { readonly weekly: number; readonly healthAlerts: number };
  /** New accounts per day (`YYYY-MM-DD`), oldest first. */
  readonly signups: readonly { readonly day: string; readonly count: number }[];
}

/** Reads `admin_overview()`'s JSON; a missing count reads as 0 and a missing list as empty. */
export function parseOverview(json: unknown): Overview {
  const root = asObject(json);
  const users = asObject(root.users);
  const devices = asObject(root.devices);
  const jobs = asObject(root.jobs);
  const emails = asObject(root.emails);
  return {
    users: {
      total: asNumber(users.total),
      confirmed: asNumber(users.confirmed),
      new7d: asNumber(users.new_7d),
      new30d: asNumber(users.new_30d),
      signedIn30d: asNumber(users.signed_in_30d),
      withMfa: asNumber(users.with_mfa),
      banned: asNumber(users.banned),
    },
    devices: {
      total: asNumber(devices.total),
      active7d: asNumber(devices.active_7d),
      versions: asArray(devices.versions)
        .map((v) => ({ version: asString(asObject(v).version, 'unknown'), devices: asNumber(asObject(v).devices) }))
        .sort((a, b) => b.devices - a.devices),
    },
    jobs: {
      total: asNumber(jobs.total),
      running: asNumber(jobs.running),
      waiting: asNumber(jobs.waiting),
      finished7d: asNumber(jobs.finished_7d),
    },
    plans: asArray(root.plans).map((p) => ({
      tier: asString(asObject(p).tier, 'unknown'),
      accounts: asNumber(asObject(p).accounts),
    })),
    emails: { weekly: asNumber(emails.weekly), healthAlerts: asNumber(emails.health_alerts) },
    signups: asArray(root.signups)
      .map((s) => ({ day: asString(asObject(s).day).slice(0, 10), count: asNumber(asObject(s).count) }))
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.day))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}

/** How many days the sign-ups chart covers. */
export const SIGNUP_DAYS = 30;

/**
 * Sign-ups for each of the {@link SIGNUP_DAYS} days ending `today` (`YYYY-MM-DD`, UTC), oldest first, as the
 * dashboard's charts take them: a day the database didn't list had no sign-ups.
 */
export function signupSeries(
  signups: Overview['signups'],
  today: string,
  days = SIGNUP_DAYS,
): { day: string; value: number }[] {
  const counts = new Map(signups.map((s) => [s.day, s.count]));
  const end = Date.parse(`${today}T00:00:00Z`);
  const series: { day: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    series.push({ day, value: counts.get(day) ?? 0 });
  }
  return series;
}

/** The words for a plan tier: Free, Plus, Pro, or the tier itself. */
export function tierLabel(tier: string | null | undefined): string {
  if (!tier) return 'Free';
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
