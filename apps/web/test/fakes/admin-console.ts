// The super-admin console's data as the database answers (#516), and a console store of `vi.fn`s around it, for the
// admin module's tests. Shapes follow `supabase/migrations/*_admin_console.sql`.
import { vi } from 'vitest';
import type { ConsoleStore } from '@/modules/admin/application/ports';
import { parseAuditLog } from '@/modules/admin/domain/audit';
import { parseOverview } from '@/modules/admin/domain/overview';
import { parsePlan } from '@/modules/admin/domain/plan';
import { parseUserDetail, parseUserPage } from '@/modules/admin/domain/users';

/** `admin_overview()`. */
export const OVERVIEW_JSON = {
  users: { total: 120, confirmed: 100, new_7d: 9, new_30d: 31, signed_in_30d: 64, with_mfa: 12, banned: 2 },
  devices: {
    total: 80,
    active_7d: 41,
    versions: [
      { version: '0.6.0', devices: 30 },
      { version: '0.6.1', devices: 50 },
    ],
  },
  jobs: { total: 900, running: 3, waiting: 4, finished_7d: 77 },
  plans: [
    { tier: 'free', accounts: 110 },
    { tier: 'plus', accounts: 8 },
    { tier: 'pro', accounts: 2 },
  ],
  emails: { weekly: 21, health_alerts: 13 },
  signups: [
    { day: '2026-11-27', count: 2 },
    { day: '2026-11-28', count: 5 },
  ],
};

/** The super-admin every fake session belongs to. */
export const ADMIN = { id: 'a0000000-0000-4000-8000-000000000001', email: 'maintainer@example.com' };

/** An ordinary account's id. */
export const GRACE_ID = '6f1c0a5e-1111-4222-8333-944455556666';

/** One row of `admin_users()`. */
export const USER_ROW_JSON = {
  id: GRACE_ID,
  email: 'grace@example.com',
  created_at: '2026-11-01T09:00:00Z',
  last_sign_in_at: '2026-11-27T08:00:00Z',
  confirmed: true,
  providers: ['email', 'google'],
  mfa: false,
  banned: false,
  superadmin: false,
  devices: 2,
  last_seen_at: '2026-11-28T07:00:00Z',
  jobs: 5,
  tier: 'plus',
};

/** `admin_user()` for that account. */
export const USER_JSON = {
  ...USER_ROW_JSON,
  banned_until: null,
  plan: { tier: 'plus', status: 'active', valid_until: '2026-12-31T00:00:00Z' },
  choices: { daily_stats: true, weekly_email: false, health_alert: true },
  devices: [
    {
      id: 'd1',
      name: 'Chrome on macOS',
      extension_version: '0.6.1',
      last_seen_at: '2026-11-28T07:00:00Z',
      created_at: '2026-11-02T10:00:00Z',
    },
  ],
  jobs: [
    {
      id: 'j1',
      kind: 'cleanup',
      title: 'Delete posts before 2024',
      state: 'running',
      x_handle: 'grace',
      matched: 40,
      done: 12,
      failed: 1,
      updated_at: '2026-11-28T07:30:00Z',
    },
  ],
  sessions: 3,
};

/** `admin_audit_log()`: a sign-out, a ban and a deletion. */
export const AUDIT_JSON = [
  {
    id: 3,
    created_at: '2026-11-28T10:00:00Z',
    actor: ADMIN.id,
    actor_email: ADMIN.email,
    action: 'delete',
    target: 'b0000000-0000-4000-8000-000000000002',
    target_email: null,
    detail: { email_domain: 'example.org' },
  },
  {
    id: 2,
    created_at: '2026-11-28T09:00:00Z',
    actor: ADMIN.id,
    actor_email: ADMIN.email,
    action: 'ban',
    target: GRACE_ID,
    target_email: 'grace@example.com',
    detail: {},
  },
  {
    id: 1,
    created_at: '2026-11-28T08:00:00Z',
    actor: ADMIN.id,
    actor_email: ADMIN.email,
    action: 'sign_out',
    target: GRACE_ID,
    target_email: 'grace@example.com',
    detail: { sessions: 3 },
  },
];

/** The maintainer's published plan, as their tool writes it (Persian words as they come). */
/** A plan with the single direction, the X gaps program's R1 and its sources, as the maintainer's tool publishes them. */
export const DIRECTION_PLAN_JSON = {
  sources: [
    { id: 'xgaps', titleFa: 'پروژه‌ی جامع X', url: 'https://claude.ai/artifact/x' },
    { id: 'brand', titleFa: 'موتور برند', url: 'https://xomoni.com/product/document' },
    { id: 'bad', titleFa: 'منبع خراب', url: 'javascript:alert(1)' },
  ],
  direction: {
    titleFa: 'مسیر واحد',
    statusFa: 'پیشنهاد مدیر محصول',
    decisions: [{ id: 'd-brand-engine', status: 'open', titleFa: 'جهت تازه' }],
    stages: [
      {
        id: 'st-brand1',
        order: 2,
        titleFa: 'کشف برند',
        whenFa: 'دسامبر',
        release: '0.8.0',
        state: 'waiting-decision',
        itemsFa: ['تحلیل‌گر برند'],
        gateFa: 'هشتاد درصد',
        sourceIds: ['brand', 'xgaps', 'missing'],
        counts: { done: 0, review: 1 },
        total: 1,
        progress: 0,
        issueList: [
          { number: 491, title: 'Scanner', status: 'review', url: 'https://github.com/pirdehi/xomoni/issues/491' },
        ],
        decisions: [{ id: 'd-ai-engine', status: 'done', titleFa: 'موتور AI' }],
      },
      {
        id: 'st-r1',
        order: 1,
        titleFa: 'اولین نسخه‌ی فروشی',
        whenFa: 'الان',
        release: '0.7.0',
        state: 'active',
        itemsFa: ['پرداخت', 'گاوصندوق'],
        gateFa: 'دروازه‌ی انتشار',
        noteFa: 'اولویت ۱',
        sourceIds: ['xgaps'],
        counts: { done: 2, review: 2 },
        total: 4,
        programWave: 'R1',
      },
    ],
    later: [{ titleFa: 'بیمه‌ی تعلیق', whyFa: 'بعد از موتور برند', sourceIds: ['xgaps'] }],
    parked: [{ titleFa: 'ایمیل', whyFa: 'LinkedIn دوم است', sourceIds: ['brand'] }],
  },
  program: {
    name: 'پروژه‌ی جامع X',
    updatedFa: '۲۸ نوامبر',
    releaseFa: 'R1 به‌صورت 0.7.0',
    labels: { done: 'ادغام شد', bad: 3 },
    r1: { total: 56, counts: { done: 12, ci: 20, now: 1, ready: 18, todo: 4, you: 1 } },
    lanes: [
      {
        key: 'billing',
        nameFa: 'مسیر ۱: پرداخت',
        agent: 'now',
        doingNowFa: 'متن‌های حقوقی',
        nextFa: ['ادغام #462'],
        counts: { done: 4, now: 1, ready: 9 },
        total: 14,
        phases: [
          { id: 'CB.1', nameFa: 'تصمیم و داده', issue: 420, issueState: 'open', counts: { done: 4, now: 1 }, total: 5 },
          { id: 'CB.0', nameFa: 'پیش از کد', issue: null, issueState: 'closed', counts: { done: 2 }, total: 2 },
        ],
      },
    ],
    founder: [
      { pr: 462, whatFa: 'تأیید متن‌های حقوقی', blocksFa: 'صفحه‌های فروش' },
      { pr: null, whatFa: 'حساب Polar', blocksFa: '' },
    ],
    merged: [{ pr: 447, dateFa: '۲۸ نوامبر', titleFa: 'Polar ساختگی' }],
    staleCount: 2,
  },
};

export const PLAN_JSON = {
  generatedAt: '2026-11-28T06:00:00Z',
  release: { latest: '0.6.1', pending: ['Vault export', { title: 'Console' }] },
  features: { total: 40, byStatus: { done: 30, todo: 10 }, byArea: { web: 12 } },
  northStar: {
    title: 'Weekly cleaners',
    titleFa: 'پاک‌کنندگان هفتگی',
    definitionFa: 'تعریف',
    value: 42,
    measured: '2026-11-27',
  },
  objectives: [
    {
      id: 'o1',
      title: 'Grow',
      titleFa: 'رشد',
      keyResults: [
        { id: 'k1', titleFa: 'کاربران فعال', target: 1000, unit: 'users', direction: 'up', value: 420, auto: true },
        { id: 'k2', titleFa: 'نرخ ریزش', target: null, unit: '%', direction: 'down', value: null, auto: false },
      ],
    },
  ],
  horizons: {
    now: [
      {
        id: 'console',
        titleFa: 'کنسول مدیریت',
        whyFa: 'برای اداره محصول',
        lane: 'web',
        state: 'progress',
        counts: { done: 3, review: 1, progress: 1, founder: 1, todo: 2, dropped: 0 },
        total: 8,
        progress: 0.375,
        issueList: [
          {
            number: 516,
            title: 'Super-admin console',
            status: 'progress',
            url: 'https://github.com/pirdehi/xomoni/issues/516',
          },
          { number: 517, title: 'Bad link', status: 'todo', url: 'javascript:alert(1)' },
        ],
      },
    ],
    next: [],
    later: [{ id: 'mail', titleFa: 'ایمیل', counts: {}, total: 0 }],
  },
  phases: [{ number: 19, title: 'Release gate', state: 'done', counts: { done: 9, dropped: 1 }, total: 10 }],
  founder: [
    { title: 'Pick a price', titleFa: 'انتخاب قیمت', ageDays: 3, link: 'https://example.com/d', impact: 'Billing' },
  ],
  issueCounts: { open: 12 },
  flow: { openPRs: 4, mergedLast7: 18, leadTimeHours: 6.5, failing: 0, conflicts: null },
  lanes: [{ id: 'web', nameFa: 'وب', openPrs: 3, limit: 2, overLimit: true }],
};

/**
 * A console store for a super-admin whose every call answers with the data above unless overridden; methods are
 * `vi.fn`s.
 */
export function fakeConsoleStore(overrides: Partial<ConsoleStore> = {}): ConsoleStore & {
  [K in keyof ConsoleStore]: ReturnType<typeof vi.fn> & ConsoleStore[K];
} {
  const store = {
    isSuperadmin: vi.fn(() => Promise.resolve(true)),
    overview: vi.fn(() => Promise.resolve(parseOverview(OVERVIEW_JSON))),
    users: vi.fn(() => Promise.resolve(parseUserPage({ total: 1, rows: [USER_ROW_JSON] }))),
    user: vi.fn((id: string) => Promise.resolve(id === GRACE_ID ? parseUserDetail(USER_JSON) : null)),
    auditLog: vi.fn(() => Promise.resolve(parseAuditLog(AUDIT_JSON))),
    plan: vi.fn(() => Promise.resolve({ plan: parsePlan(PLAN_JSON), updatedAt: '2026-11-28T06:05:00Z' })),
    signOutUser: vi.fn(() => Promise.resolve(3)),
    setBanned: vi.fn(() => Promise.resolve()),
    deleteUser: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  return store as ReturnType<typeof fakeConsoleStore>;
}
