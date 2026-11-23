import type { BrowserContext, Locator, Page } from '@playwright/test';
import {
  acceptRisks,
  browseProfile,
  confirmCleanup,
  continueWithoutArchive,
  jobCard,
  keepRules,
  openCleanup,
  openPage,
  removeBefore,
  risksDialog,
  workAnyTime,
} from '../support/cleanup';
import { expect, openXWindow, test } from '../support/extension';
import { FIXTURE_ACCOUNT, FRIEND_ACCOUNT, servePage } from '../support/x-fixtures';
import { CLOUD_URL, type CloudCall, type XomoniSite, serveXomoniSite } from '../support/xomoni-site';

// Your jobs, live on xomoni.com (docs/scenarios/39-live-job-status.md, #39, #40, #345), as the extension sends them:
// while its dashboard is open, Xomoni signed in to xomoni.com reports each job's status, and only that (ADR-0004,
// ADR-0018). The built extension runs in a real browser on x.com served from synthetic fixtures (ADR-0040), with
// xomoni.com and its database played at the extension (`serveXomoniSite`), which keeps every call Xomoni made. The
// website's half, the dashboard that shows the reports, is in e2e/live-job-status.spec.ts.

test.use({ xHistory: 'long' });

/** A job as `device_report` carries it: the fields of the website's `jobs` table, and nothing else (`cloud/summary.ts`). */
interface JobReport {
  local_id: string;
  x_handle: string;
  kind: string;
  title: string;
  state: string;
  phase: string;
  state_reason: string;
  matched: number;
  done: number;
  skipped: number;
  failed: number;
  scanned: number;
  risk_level: number | null;
  started_at: string | null;
  finished_at: string | null;
}

/** The fields a job report has, in the order `cloud/summary.ts` writes them. */
const REPORT_FIELDS = [
  'local_id',
  'x_handle',
  'kind',
  'title',
  'state',
  'phase',
  'state_reason',
  'matched',
  'done',
  'skipped',
  'failed',
  'scanned',
  'risk_level',
  'started_at',
  'finished_at',
];

/** The job *Complete my copy* starts. */
const COMPLETE = 'Complete my copy';

/** The job a cleanup of posts before Jan 1, 2021 becomes. */
const BEFORE_2021 = 'Delete posts older than Jan 1, 2021';

/** The status reports Xomoni sent xomoni.com so far, in order. */
const reports = (site: XomoniSite): CloudCall[] => site.calls.filter((call) => call.fn === 'device_report');

/** Every job report sent so far, oldest first. */
const reported = (site: XomoniSite): JobReport[] => reports(site).flatMap((call) => call.body.jobs as JobReport[]);

/** The newest report of the job titled `title`, or undefined before one was sent. */
const lastReportOf = (site: XomoniSite, title: string): JobReport | undefined =>
  reported(site)
    .filter((job) => job.title === title)
    .at(-1);

/** xomoni.com played at the extension, with Xomoni signed in to it from a xomoni.com page, as the website does. */
async function signedIn(context: BrowserContext, extensionId: string): Promise<XomoniSite> {
  const site = await serveXomoniSite(context);
  expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
  return site;
}

/** Opens the Library's *Other ways* and presses *Complete my copy*. */
async function pressCompleteMyCopy(dashboard: Page) {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
  await dashboard.getByRole('button', { name: 'Other ways: read from X' }).click();
  await dashboard.getByRole('button', { name: 'Complete my copy' }).click();
}

/** *Complete my copy*, left Ready with *Not now* on the risks: a job that exists and hasn't touched X. */
async function readyRead(dashboard: Page): Promise<Locator> {
  await pressCompleteMyCopy(dashboard);
  await risksDialog(dashboard).getByRole('button', { name: 'Not now' }).click();
  const card = jobCard(dashboard, COMPLETE);
  await expect(card).toContainText('Ready');
  return card;
}

/** *Complete my copy*, started: the risks accepted. */
async function startedRead(dashboard: Page): Promise<Locator> {
  await pressCompleteMyCopy(dashboard);
  await acceptRisks(dashboard);
  const card = jobCard(dashboard, COMPLETE);
  await expect(card).toContainText(/Running|Waiting/);
  return card;
}

/** The person opened the X window and browsed their profile's tabs on X, so Xomoni knows the account and its posts. */
async function withAccount(dashboard: Page, page: Page) {
  await openXWindow(dashboard);
  await browseProfile(page);
}

/** A report comes a few seconds after a job changes (10 s of quiet first), so a poll waits up to this long. */
const REPORT_WITHIN = 30_000;

test.describe('your jobs, live on xomoni.com: what Xomoni sends', { tag: '@task-39' }, () => {
  test('S39-01 signed in from xomoni.com, Xomoni reports the jobs it has at once, with their status', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await withAccount(dashboard, page);
    await readyRead(dashboard);

    const site = await signedIn(context, extensionId);
    await expect.poll(() => reports(site).length).toBeGreaterThan(0);
    const first = reports(site)[0]!;
    expect(first.body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(first.body.jobs).toEqual([
      {
        local_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        x_handle: FIXTURE_ACCOUNT.handle,
        kind: 'scan',
        title: COMPLETE,
        state: 'queued',
        phase: '',
        state_reason: '',
        matched: 0,
        done: 0,
        skipped: 0,
        failed: 0,
        scanned: 0,
        risk_level: 0,
        started_at: null,
        finished_at: null,
      },
    ]);
  });

  test('S39-02 a job that starts is reported a few seconds later, running, with when it started', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    // Each report follows its change after 10 seconds of quiet.
    test.setTimeout(90_000);
    await withAccount(dashboard, page);
    const site = await signedIn(context, extensionId);
    await startedRead(dashboard);

    await expect
      .poll(() => lastReportOf(site, COMPLETE)?.state, { timeout: REPORT_WITHIN })
      .toMatch(/^(running|waiting)$/);
    const job = lastReportOf(site, COMPLETE)!;
    expect(job.kind).toBe('scan');
    expect(Date.parse(job.started_at ?? '')).toBeGreaterThan(Date.now() - 5 * 60_000);
    expect(job.finished_at).toBeNull();
  });

  test('S39-03 Pause and Cancel in Xomoni are reported, Cancel with when the job ended', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    // Each report follows its change after 10 seconds of quiet.
    test.setTimeout(90_000);
    await withAccount(dashboard, page);
    const site = await signedIn(context, extensionId);
    const card = await startedRead(dashboard);

    await card.getByRole('button', { name: 'Pause' }).click();
    await expect(card).toContainText('Paused');
    await expect.poll(() => lastReportOf(site, COMPLETE)?.state, { timeout: REPORT_WITHIN }).toBe('paused');

    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => lastReportOf(site, COMPLETE)?.state, { timeout: REPORT_WITHIN }).toBe('cancelled');
    expect(Date.parse(lastReportOf(site, COMPLETE)?.finished_at ?? '')).toBeGreaterThan(Date.now() - 60_000);
  });

  test('S39-04 a read’s progress goes in words: the page it reached, and how many posts it looked at', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    // X's Home, then the profile, each at the warm-up's pace: up to 2 minutes with a long pause.
    test.setTimeout(180_000);
    await withAccount(dashboard, page);
    await workAnyTime(dashboard);
    const site = await signedIn(context, extensionId);
    await startedRead(dashboard);

    await expect.poll(() => lastReportOf(site, COMPLETE)?.phase, { timeout: 150_000 }).toMatch(/^Page \d+ of \d+$/);
    // The profile first, of the timelines and X search's half-years back to 2017.
    expect(lastReportOf(site, COMPLETE)?.phase).toMatch(/^Page 1 of \d{2}$/);
  });

  test('S39-05 only status leaves: no post’s text, id or author, and no keep word, in anything sent', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await withAccount(dashboard, page);
    // A cleanup with a keep word, left Ready.
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2021-01-01');
    const rules = keepRules(dashboard);
    await rules.toggle.click();
    await rules.keywords.fill('launch, thread');
    await continueWithoutArchive(dashboard);
    await confirmCleanup(dashboard);
    await risksDialog(dashboard).getByRole('button', { name: 'Not now' }).click();
    await expect(jobCard(dashboard, BEFORE_2021)).toContainText('Ready');

    const site = await signedIn(context, extensionId);
    await expect.poll(() => lastReportOf(site, BEFORE_2021)?.state).toBe('queued');
    for (const job of reported(site)) expect(Object.keys(job)).toEqual(REPORT_FIELDS);
    const sent = JSON.stringify(site.calls);
    // The copy's posts, replies and likes: their words, ids and the other account they name.
    for (const secret of ['Our launch went well', 'made-up post', 'made-up reply', 'thread'])
      expect(sent).not.toContain(secret);
    // The fixtures' post ids: the account's 9000000000000000101 to …108, and its friend's …201 to …203.
    expect(sent).not.toMatch(/90{15}[12]\d\d/);
    expect(sent).not.toContain(FRIEND_ACCOUNT.handle);
    expect(sent).not.toContain(FRIEND_ACCOUNT.id);
    expect(sent).not.toContain('launch, thread');
  });

  test('S39-06 a job stopped on X’s notice is reported stopped, and X’s notice never leaves', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    test.setTimeout(180_000);
    await withAccount(dashboard, page);
    await workAnyTime(dashboard);
    await servePage(context, '/home', 'home-limited.html');
    const site = await signedIn(context, extensionId);
    const card = await startedRead(dashboard);

    // Home is a page load at the warm-up's pace: up to 2 minutes with a long pause.
    await expect(card).toContainText('Stopped for safety', { timeout: 150_000 });
    await expect.poll(() => lastReportOf(site, COMPLETE)?.state, { timeout: REPORT_WITHIN }).toBe('blocked');
    expect(lastReportOf(site, COMPLETE)?.state_reason).toBe('');
    // The ladder's level goes, X's words don't.
    expect(lastReportOf(site, COMPLETE)?.risk_level).toBe(3);
    expect(JSON.stringify(site.calls)).not.toContain('temporarily limited');
  });

  test('S39-07 Watch, which never ends, is never reported', async ({ dashboard, page, context, extensionId }) => {
    // Each report follows its change after 10 seconds of quiet.
    test.setTimeout(90_000);
    await withAccount(dashboard, page);
    await workAnyTime(dashboard);
    const site = await signedIn(context, extensionId);
    await readyRead(dashboard);
    await dashboard.getByRole('navigation').getByRole('button', { name: 'Watch', exact: true }).click();
    await dashboard.getByRole('textbox', { name: 'Phrase or #hashtag' }).fill('#xomonifixture');
    await dashboard.getByRole('button', { name: 'Save', exact: true }).click();
    await dashboard.getByRole('button', { name: 'Start watching' }).click();
    await acceptRisks(dashboard);
    await expect(dashboard.getByRole('button', { name: 'Pause watching' })).toBeVisible();

    // A change to another job is reported, with Watch still left out.
    await openPage(dashboard, 'Activity');
    await jobCard(dashboard, COMPLETE).getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => lastReportOf(site, COMPLETE)?.state, { timeout: REPORT_WITHIN }).toBe('cancelled');
    expect(reported(site).map((job) => job.kind)).not.toContain('watch');
    expect(reported(site).map((job) => job.title)).not.toContain('Watch X searches');
  });

  test('S39-08 not signed in to xomoni.com, nothing at all goes there, while jobs start and stop', async ({
    dashboard,
    page,
    context,
  }) => {
    // Each report follows its change after 10 seconds of quiet.
    test.setTimeout(90_000);
    await withAccount(dashboard, page);
    const site = await serveXomoniSite(context);
    const card = await startedRead(dashboard);
    await card.getByRole('button', { name: 'Pause' }).click();
    await expect(card).toContainText('Paused');
    // Longer than a report takes to follow a change.
    await dashboard.waitForTimeout(15_000);
    expect(site.calls).toEqual([]);
  });

  test('S39-09 while xomoni.com can’t be reached, the job goes on, and what changed is sent once it can', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    // Each report follows its change after 10 seconds of quiet.
    test.setTimeout(90_000);
    await withAccount(dashboard, page);
    const site = await signedIn(context, extensionId);
    await expect.poll(() => reports(site).length).toBeGreaterThan(0);

    // xomoni.com unreachable: the request fails, as with no connection.
    const tried: string[] = [];
    const unreachable = (url: URL) => url.origin === CLOUD_URL;
    await context.route(unreachable, (route) => {
      tried.push(route.request().url());
      return route.abort('internetdisconnected');
    });
    const card = await readyRead(dashboard);
    await expect.poll(() => tried.length, { timeout: REPORT_WITHIN }).toBeGreaterThan(0);
    await expect(card).toContainText('Ready');
    expect(lastReportOf(site, COMPLETE)).toBeUndefined();

    // Back: the next change sends this job too, with the one it missed.
    await context.unroute(unreachable);
    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => lastReportOf(site, COMPLETE)?.state, { timeout: REPORT_WITHIN }).toBe('cancelled');
  });

  test('S39-10 when xomoni.com no longer knows this browser, Xomoni says so and stops sending', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    // Each report follows its change after 10 seconds of quiet.
    test.setTimeout(90_000);
    await withAccount(dashboard, page);
    const site = await signedIn(context, extensionId);
    await expect.poll(() => reports(site).length).toBeGreaterThan(0);

    // The person disconnected this browser on xomoni.com: its token is unknown there now.
    await context.route(
      (url) => url.origin === CLOUD_URL && url.pathname.endsWith('/device_report'),
      (route) =>
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'P0001', hint: 'unknown_device', message: 'unknown_device' }),
        }),
    );
    const card = await readyRead(dashboard);
    await expect(
      dashboard.getByText(
        'xomoni.com no longer knows this browser: it was disconnected there, or sent nothing for 90 days. Connect it again in Settings to keep sending job status.',
      ),
    ).toBeVisible({ timeout: REPORT_WITHIN });
    await openPage(dashboard, 'Settings');
    await expect(dashboard.getByRole('button', { name: 'Sign in to xomoni.com' })).toBeVisible();

    const before = site.calls.length;
    await openPage(dashboard, 'Activity');
    await card.getByRole('button', { name: 'Cancel' }).click();
    await dashboard.waitForTimeout(15_000);
    expect(site.calls.length).toBe(before);
  });

  test('S39-11 a reload pauses the running job, which is reported paused, and reporting goes on', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    // Each report follows its change after 10 seconds of quiet.
    test.setTimeout(90_000);
    await withAccount(dashboard, page);
    const site = await signedIn(context, extensionId);
    await startedRead(dashboard);
    await expect
      .poll(() => lastReportOf(site, COMPLETE)?.state, { timeout: REPORT_WITHIN })
      .toMatch(/^(running|waiting)$/);

    await dashboard.reload();
    const card = jobCard(dashboard, COMPLETE);
    await expect(card).toContainText('Paused');
    await expect.poll(() => lastReportOf(site, COMPLETE)?.state, { timeout: REPORT_WITHIN }).toBe('paused');
    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => lastReportOf(site, COMPLETE)?.state, { timeout: REPORT_WITHIN }).toBe('cancelled');
  });
});
