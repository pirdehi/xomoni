import type { BrowserContext, Locator, Page } from '@playwright/test';
import { acceptRisks, browseProfile, jobCard, openPage, risksDialog } from '../support/cleanup';
import { expect, openXWindow, test } from '../support/extension';
import { DEVICE_ID, SITE, type XomoniSite, serveXomoniSite } from '../support/xomoni-site';

// Xomoni's actions on xomoni.com, from Xomoni's side (docs/scenarios/251-website-actions.md, #251, ADR-0027, #345):
// Xomoni hears a job's Pause, Cancel and Resume and an Open from a xomoni.com page, acts only for the device it is
// signed in as, and never starts work: Resume asks the person in Xomoni. The built extension runs in a real browser
// on x.com served from synthetic fixtures (ADR-0040); xomoni.com is played at it (`serveXomoniSite`), sending what the
// website sends. A job is the Library's *Complete my copy*, a read that changes nothing on X.

test.use({ xHistory: 'long' });

/** The job *Complete my copy* starts. */
const COMPLETE = 'Complete my copy';

/** A job as Xomoni reports it to xomoni.com. */
interface JobReport {
  local_id: string;
  title: string;
  state: string;
}

/** The newest report of the job titled `title`, or undefined before one was sent. */
const lastReportOf = (site: XomoniSite, title: string): JobReport | undefined =>
  site.calls
    .filter((call) => call.fn === 'device_report')
    .flatMap((call) => call.body.jobs as JobReport[])
    .filter((job) => job.title === title)
    .at(-1);

/** A report comes a few seconds after a job changes (10 s of quiet first), so a poll waits up to this long. */
const REPORT_WITHIN = 30_000;

/**
 * The person opened the X window and browsed their posts, and Xomoni is signed in from a xomoni.com page. Returns the
 * played site and a xomoni.com page, from which the website's messages go.
 */
async function ready(dashboard: Page, page: Page, context: BrowserContext, extensionId: string) {
  await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
  const site = await serveXomoniSite(context);
  expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
  const activity = await context.newPage();
  await activity.goto(`${SITE}/dashboard/activity`);
  return { site, activity };
}

/** Opens the Library's *Other ways* and presses *Complete my copy*. */
async function pressCompleteMyCopy(dashboard: Page) {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
  await dashboard.getByRole('button', { name: 'Other ways: read from X' }).click();
  await dashboard.getByRole('button', { name: 'Complete my copy' }).click();
}

/** *Complete my copy*, started: the risks accepted. Returns its card. */
async function startedRead(dashboard: Page): Promise<Locator> {
  await pressCompleteMyCopy(dashboard);
  await acceptRisks(dashboard);
  const card = jobCard(dashboard, COMPLETE);
  await expect(card).toContainText(/Running|Waiting/);
  return card;
}

/** *Complete my copy*, left Ready with *Not now* on the risks: a job that exists and hasn't touched X. */
async function readyRead(dashboard: Page): Promise<Locator> {
  await pressCompleteMyCopy(dashboard);
  await risksDialog(dashboard).getByRole('button', { name: 'Not now' }).click();
  const card = jobCard(dashboard, COMPLETE);
  await expect(card).toContainText('Ready');
  return card;
}

/** The job's id in Xomoni, as its report names it to xomoni.com. */
async function localIdOf(site: XomoniSite, title: string): Promise<string> {
  await expect.poll(() => lastReportOf(site, title), { timeout: REPORT_WITHIN }).toBeDefined();
  return lastReportOf(site, title)!.local_id;
}

/** A job action as the website sends it. */
const jobAction = (action: string, jobId: string, deviceId = DEVICE_ID) => ({
  type: 'xomoni-job',
  action,
  deviceId,
  jobId,
});

/** The dashboard's request, from xomoni.com, to resume a job. */
const resumeAsk = (dashboard: Page) => dashboard.getByRole('dialog', { name: 'xomoni.com asks to resume a job' });

test.describe('Xomoni’s actions on xomoni.com, answered by Xomoni', { tag: '@task-251' }, () => {
  test('S251-23 Pause from xomoni.com stops a running job after the action in progress, and the log says who asked', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, activity } = await ready(dashboard, page, context, extensionId);
    const card = await startedRead(dashboard);
    const jobId = await localIdOf(site, COMPLETE);
    expect(await site.send(activity, extensionId, jobAction('pause', jobId))).toEqual({
      ok: true,
      outcome: 'stopping',
    });
    await expect(card).toContainText('Paused');
    await openPage(dashboard, 'Activity');
    await dashboard.getByRole('tab', { name: 'Log' }).click();
    await expect(dashboard.getByText('xomoni.com asked to pause this job.')).toBeVisible();
  });

  test('S251-24 Cancel from xomoni.com ends a job that isn’t running at once, and xomoni.com hears it', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, activity } = await ready(dashboard, page, context, extensionId);
    const card = await readyRead(dashboard);
    const jobId = await localIdOf(site, COMPLETE);
    expect(await site.send(activity, extensionId, jobAction('cancel', jobId))).toEqual({
      ok: true,
      outcome: 'cancelled',
    });
    // An ended job leaves Activity's Open jobs: it is under All.
    await expect(dashboard.getByText('No open jobs')).toBeVisible();
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    await expect(card).toContainText('Cancelled');
    await expect(card).toContainText('Cancelled from xomoni.com.');
    await expect.poll(() => lastReportOf(site, COMPLETE)?.state, { timeout: REPORT_WITHIN }).toBe('cancelled');
  });

  test('S251-25 Resume from xomoni.com only asks: Xomoni shows the request, and the job stays as it was', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, activity } = await ready(dashboard, page, context, extensionId);
    const card = await readyRead(dashboard);
    const jobId = await localIdOf(site, COMPLETE);
    expect(await site.send(activity, extensionId, jobAction('resume', jobId))).toEqual({ ok: true, outcome: 'asked' });
    await dashboard.bringToFront();
    const ask = resumeAsk(dashboard);
    await expect(ask).toContainText(COMPLETE);
    await expect(ask).toContainText('The website can only ask. Nothing runs on X until you choose Resume here.');
    await expect(card).toContainText('Ready');
  });

  test('S251-26 Not now on the request leaves the job as it was; Resume there starts it', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, activity } = await ready(dashboard, page, context, extensionId);
    const card = await readyRead(dashboard);
    const jobId = await localIdOf(site, COMPLETE);
    await site.send(activity, extensionId, jobAction('resume', jobId));
    await dashboard.bringToFront();
    await resumeAsk(dashboard).getByRole('button', { name: 'Not now' }).click();
    await expect(resumeAsk(dashboard)).toHaveCount(0);
    await expect(card).toContainText('Ready');

    await site.send(activity, extensionId, jobAction('resume', jobId));
    await dashboard.bringToFront();
    await resumeAsk(dashboard).getByRole('button', { name: 'Resume' }).click();
    // The person's own start: the risks are asked as for any start.
    await acceptRisks(dashboard);
    await expect(card).toContainText(/Running|Waiting/);
  });

  test('S251-27 an action naming another account’s device is refused, and the job is untouched', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, activity } = await ready(dashboard, page, context, extensionId);
    const card = await readyRead(dashboard);
    const jobId = await localIdOf(site, COMPLETE);
    const other = '9e000000-0000-4000-8000-000000000999';
    for (const action of ['pause', 'cancel', 'resume'])
      expect(await site.send(activity, extensionId, jobAction(action, jobId, other))).toEqual({
        ok: false,
        reason: 'other_account',
      });
    expect(await site.send(activity, extensionId, { type: 'xomoni-open', page: 'library', deviceId: other })).toEqual({
      ok: false,
      reason: 'other_account',
    });
    await expect(card).toContainText('Ready');
    await expect(resumeAsk(dashboard)).toHaveCount(0);
  });

  test('S251-28 a job Xomoni doesn’t have, one not running, and one that ended each get their reason', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, activity } = await ready(dashboard, page, context, extensionId);
    await readyRead(dashboard);
    const jobId = await localIdOf(site, COMPLETE);
    expect(await site.send(activity, extensionId, jobAction('pause', 'no-such-job'))).toEqual({
      ok: false,
      reason: 'no_job',
    });
    expect(await site.send(activity, extensionId, jobAction('pause', jobId))).toEqual({
      ok: false,
      reason: 'not_running',
    });
    await site.send(activity, extensionId, jobAction('cancel', jobId));
    expect(await site.send(activity, extensionId, jobAction('resume', jobId))).toEqual({
      ok: false,
      reason: 'finished',
    });
  });

  test('S251-29 Open from xomoni.com opens that page of Xomoni', async ({ dashboard, page, context, extensionId }) => {
    const { site, activity } = await ready(dashboard, page, context, extensionId);
    expect(
      await site.send(activity, extensionId, { type: 'xomoni-open', page: 'settings', deviceId: DEVICE_ID }),
    ).toEqual({ ok: true, outcome: 'opened' });
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  });

  test('S251-30 before Xomoni is signed in to xomoni.com, it takes no action', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    const card = await readyRead(dashboard);
    const site = await serveXomoniSite(context);
    const activity = await context.newPage();
    await activity.goto(`${SITE}/dashboard/activity`);
    for (const action of ['pause', 'cancel', 'resume'])
      expect(await site.send(activity, extensionId, jobAction(action, 'any-job'))).toEqual({
        ok: false,
        reason: 'not_connected',
      });
    await expect(card).toContainText('Ready');
  });

  test('S251-31 a message that isn’t one of the website’s actions is refused as invalid: there is no Start', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, activity } = await ready(dashboard, page, context, extensionId);
    const card = await readyRead(dashboard);
    const jobId = await localIdOf(site, COMPLETE);
    for (const message of [
      jobAction('start', jobId),
      jobAction('approve', jobId),
      { ...jobAction('resume', jobId), confirmed: true },
      { type: 'xomoni-open', page: 'chrome://extensions', deviceId: DEVICE_ID },
    ])
      expect(await site.send(activity, extensionId, message)).toEqual({ ok: false, reason: 'invalid' });
    await expect(card).toContainText('Ready');
    await expect(resumeAsk(dashboard)).toHaveCount(0);
  });
});
