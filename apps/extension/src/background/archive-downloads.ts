// Where Chrome saves X's archive (#196, ADR-0022). Chrome never lets an extension read Downloads itself, only a folder
// inside it, so while Xomoni expects X's archive, a download named like it is saved in Downloads/Xomoni, the folder
// the person lets Xomoni read. The note that makes that folder is placed there too. Every other download is left as
// it is, and nothing about it is kept.
import { expectingArchive } from '../shared/db';
import { ARCHIVE_FILE, ARCHIVE_FOLDER, FOLDER_NOTE, FOLDER_NOTE_URL, archiveDownloadPath } from '../shared/x-archive';

/** What Chrome tells the listener about a download about to be saved. */
interface PendingDownload {
  readonly filename: string;
  readonly url?: string;
  readonly byExtensionId?: string;
}

/** Where Chrome should save a download, relative to Downloads, and what to do if a file has that name. */
export interface DownloadTarget {
  filename: string;
  conflictAction: 'uniquify' | 'overwrite';
}

/** Chrome's answer callback: a target, or nothing to keep Chrome's own choice. */
type Suggest = (suggestion?: DownloadTarget) => void;

/**
 * Where to save this download, or null to leave it alone. Xomoni's own note (by `ownId` and its fixed address) goes
 * in the Xomoni folder, replacing an older one; X's archive goes there while Xomoni expects one (`expectingArchive`).
 * The database is read only for a file named like X's archive, so other downloads are answered at once.
 */
export async function archiveDownloadTarget(
  item: PendingDownload,
  ownId: string,
  now = Date.now(),
): Promise<DownloadTarget | null> {
  if (item.byExtensionId === ownId && item.url === FOLDER_NOTE_URL) {
    return { filename: `${ARCHIVE_FOLDER}/${FOLDER_NOTE}`, conflictAction: 'overwrite' };
  }
  const name = item.filename.split(/[\\/]/).pop() ?? '';
  if (!ARCHIVE_FILE.test(name)) return null;
  const path = archiveDownloadPath(name, await expectingArchive(now));
  return path ? { filename: path, conflictAction: 'uniquify' } : null;
}

/**
 * The `downloads.onDeterminingFilename` listener. Chrome holds every download until it answers, so it always
 * answers, also when the database can't be read; it answers later, which is why it returns true.
 */
export function suggestArchivePath(item: PendingDownload, suggest: Suggest): true {
  void archiveDownloadTarget(item, chrome.runtime.id).then(
    (target) => (target ? suggest(target) : suggest()),
    () => suggest(),
  );
  return true;
}
