// What the dashboard does by itself after the person asked for X's archive (#186, ADR-0022), so nobody has to come
// back for it: while X makes the archive it looks at X's page now and then, as a short job of its own, and once the
// job pressed *Download archive* it imports the ZIP from the Downloads folder, wherever the dashboard is.
import { archiveJob } from '../engine/runner';
import { archiveImportedAt, archiveRequest, getSettings, hasConsent, saveArchiveRequest } from '../shared/db';
import { withinActiveHours } from '../shared/settings';
import { HOUR } from '../shared/time';
import type { Account, Job } from '../shared/types';
import { nextArchiveLook } from '../shared/x-archive';
import { type FolderImport, type FolderStore, canRead, importNewestArchive, kvFolderStore } from './downloads-folder';

/** How long after *Download archive* the dashboard keeps looking in Downloads for the ZIP. */
export const IMPORT_WINDOW_MS = 12 * HOUR;

/** The part of the runner the look needs: whether a job runs in this tab, and how to start one. */
export interface LookRunner {
  readonly busy: boolean;
  start(jobId: string): Promise<void>;
}

/**
 * Starts the dashboard's own look at X's archive page when one is due (`nextArchiveLook`), but only while no job
 * runs here, within the person's active hours, and for an account whose risks the person already accepted (a look
 * never asks). The look is remembered first, so one that can't finish waits its turn instead of starting again a
 * minute later. Returns the job it started, or null.
 */
export async function lookIfDue(accountId: string, runner: LookRunner, now = Date.now()): Promise<Job | null> {
  if (runner.busy) return null;
  const request = await archiveRequest(accountId);
  const due = nextArchiveLook(request, now);
  if (!request || due == null || due > now) return null;
  if (!withinActiveHours((await getSettings()).activeHours, new Date(now))) return null;
  if (!(await hasConsent(accountId))) return null;
  await saveArchiveRequest(accountId, { ...request, checkedAt: now });
  const job = await archiveJob(accountId, 'look');
  // Refused when another dashboard tab runs a job, or one started meanwhile: the next look is in a few hours.
  runner.start(job.id).catch(() => {});
  return job;
}

/**
 * Imports X's archive from the Downloads folder after the archive job pressed *Download archive*, until it is
 * imported or `IMPORT_WINDOW_MS` passed. Only with a folder the person chose and Chrome lets Xomoni read without
 * asking; otherwise the Library shows how. Returns what it did, or null.
 */
export async function importIfDownloaded(
  account: Account,
  store: FolderStore = kvFolderStore,
  now = Date.now(),
): Promise<FolderImport> {
  const request = await archiveRequest(account.id);
  const downloadedAt = request?.downloadedAt;
  if (downloadedAt == null || now - downloadedAt > IMPORT_WINDOW_MS) return null;
  const imported = await archiveImportedAt(account.id);
  if (imported != null && imported >= downloadedAt) return null;
  const folder = await store.get();
  if (!folder || !(await canRead(folder, false))) return null;
  return importNewestArchive(account, folder, () => {});
}
