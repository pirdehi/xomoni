// The archive job (#186, ADR-0022): gets X's archive of the account through X's own settings page in the worker
// window, the way a person would. It presses X's *Request archive* and, once X has made the archive, *Download
// archive*, and nothing else. When X asks for the password or a code, it waits for the person, who types it on X;
// Xomoni never sees it (ADR-0003). The download is the browser's own, and the dashboard imports the ZIP from the
// Xomoni folder in Downloads (#187, #196). Between the two, the dashboard looks again by itself (`nextArchiveLook`).
import { needMessage } from '../shared/attention';
import { archiveRequest, saveArchiveRequest } from '../shared/db';
import type { ArchiveButton } from '../shared/messages';
import { ARCHIVE_PAGE_URL, ARCHIVE_PATH } from '../shared/x-archive';
import { type JobContext, NeedsYou, Stop } from './context';
import { randomBetween, sleep } from './timers';

/** How long the job waits for X's archive page to show something Xomoni knows. */
const PAGE_TIMEOUT_MS = 20_000;

/** Why the job pauses on an archive page it doesn't recognize, having pressed nothing. */
export const UNKNOWN_ARCHIVE_PAGE =
  'X’s archive page doesn’t look as Xomoni expects, so it pressed nothing. In the X window, ask X for the archive yourself, or download it if X has made it; Xomoni imports the ZIP from Downloads › Xomoni.';

/** What the job ends with while X makes the archive. */
export const ARCHIVE_PREPARING =
  'X is making your archive. Xomoni looks again by itself, from a day after asking, and downloads it when it’s ready.';

/** What the job ends with once it pressed *Download archive*. */
export const ARCHIVE_DOWNLOADING =
  'Pressed X’s “Download archive”. Chrome saves the ZIP in Downloads › Xomoni, and Xomoni imports it from there.';

/** What the dashboard's own look ends with when X shows no archive at all: it expired, or X dropped the request. */
export const ARCHIVE_NOTHING_ON_X =
  'X shows no archive being made or ready. Press “Get my archive” in the Library to ask X again.';

/** The buttons' names in Xomoni's messages. */
const BUTTON_NAME: Record<ArchiveButton, string> = {
  request: '“Request archive”',
  download: '“Download archive”',
};

/** Why the job pauses when a press didn't work, having pressed nothing else. */
export const pressFailed = (button: ArchiveButton) =>
  `Xomoni couldn’t press X’s ${BUTTON_NAME[button]}, so it pressed nothing else. Press it yourself in the X window; Xomoni imports the ZIP from Downloads › Xomoni.`;

/**
 * Runs an archive job: opens X's archive page (unless the worker is already on it, as after X asked for the
 * password, since loading it again could make X ask again), then acts on what the page shows. `identity` waits for
 * the person; `request` presses *Request archive* when the person asked (`get`), and ends a `look` with nothing to
 * look for; `preparing` remembers the request; `ready` presses *Download archive*; anything else pauses, pressing
 * nothing. Every press needs the page to show exactly that one button.
 */
export async function runArchive(ctx: JobContext) {
  const mode = ctx.job.archive ?? 'get';
  const accountId = ctx.job.accountId;
  const here = await ctx.xTab.ping();
  if (here?.path.replace(/\/+$/, '') !== ARCHIVE_PATH) await ctx.openPage(ARCHIVE_PAGE_URL);

  // At most: X's offer, pressed; then the archive being made. More means the page isn't what Xomoni expects.
  let asked = false;
  for (let look = 0; look < 3; look++) {
    ctx.checkpoint();
    ctx.status('Reading X’s archive page');
    const state = await ctx.xTab.send({ cmd: 'archiveState', timeoutMs: PAGE_TIMEOUT_MS });
    await ctx.setPhase(state);
    // The request this page belongs to: the one kept, unless it was already downloaded or Xomoni just asked again.
    const known = await archiveRequest(accountId);
    const requestedAt = known && known.downloadedAt == null && !asked ? known.requestedAt : Date.now();
    switch (state) {
      case 'identity':
        throw new NeedsYou('identity', needMessage('identity', ctx.handle));
      case 'unknown':
        throw new Stop('paused', UNKNOWN_ARCHIVE_PAGE);
      case 'preparing':
        await saveArchiveRequest(accountId, { requestedAt, checkedAt: Date.now(), downloadedAt: null });
        await finish(ctx, ARCHIVE_PREPARING);
        return;
      case 'ready':
        await press(ctx, 'download');
        await saveArchiveRequest(accountId, { requestedAt, checkedAt: Date.now(), downloadedAt: Date.now() });
        await finish(ctx, ARCHIVE_DOWNLOADING);
        return;
      case 'request':
        // Only the person asks X for an archive; the dashboard's own look never does.
        if (mode === 'look') {
          await saveArchiveRequest(accountId, null);
          await finish(ctx, ARCHIVE_NOTHING_ON_X);
          return;
        }
        // Once per run: X still offering a new archive right after the press is a page Xomoni doesn't understand.
        if (asked) throw new Stop('paused', UNKNOWN_ARCHIVE_PAGE);
        await press(ctx, 'request');
        asked = true;
        break;
    }
  }
  throw new Stop('paused', UNKNOWN_ARCHIVE_PAGE);
}

/**
 * Presses one of the archive page's buttons after the page checks and a short, varied pause. X asking for the
 * password instead waits for the person; any other refusal or failure pauses the job.
 */
async function press(ctx: JobContext, button: ArchiveButton) {
  await ctx.verifyPage();
  await sleep(randomBetween(1500, 4000), ctx.signal);
  ctx.status(`Pressing ${BUTTON_NAME[button]} on X’s archive page`);
  const result = await ctx.xTab.send({ cmd: 'archivePress', button });
  if (result.outcome === 'done') {
    ctx.job.stats.done++;
    await ctx.log('success', 'system', `Pressed ${BUTTON_NAME[button]} on X’s archive page`);
    await ctx.save();
    return;
  }
  if (result.state === 'identity') throw new NeedsYou('identity', needMessage('identity', ctx.handle));
  await ctx.log('warn', 'system', `Did not press ${BUTTON_NAME[button]}: ${result.message}`);
  throw new Stop('paused', pressFailed(button));
}

/** Logs how the job ends and keeps it as the job's final reason. */
async function finish(ctx: JobContext, message: string) {
  ctx.notes.push(message);
  await ctx.log('info', 'system', message);
}
