// Why a one-click update (#305, ADR-0033) didn't happen, in the person's words. Every problem leaves Xomoni as it was:
// nothing is written before the release is downloaded and checked, and a write that fails is undone.

/** Each reason a one-click update stops. */
export type UpdateProblem =
  /** This browser can't check an Ed25519 signature (Chrome before 137) or has no folder picker. */
  | 'unsupported'
  /** This build trusts no signing key, so it could check nothing. */
  | 'no-key'
  /** Xomoni came from a store, which updates it. */
  | 'not-zip'
  /** The version asked for isn't newer than the one running. */
  | 'not-newer'
  /** A job runs (the runner holds its Web Lock); the update waits until none does. */
  | 'busy'
  /** Xomoni's folder hasn't been chosen yet. */
  | 'no-folder'
  /** The person didn't let Xomoni write to its folder. */
  | 'folder-denied'
  /** Chrome needs a fresh click before it asks for the folder again. */
  | 'needs-click'
  /** The chosen folder doesn't hold this Xomoni at this version any more. */
  | 'wrong-folder'
  /** The person didn't let Xomoni download from GitHub. */
  | 'download-denied'
  /** The download failed, was too large or came from elsewhere. */
  | 'download-failed'
  /** The release has no signature next to its zip. */
  | 'unsigned'
  /** The signature doesn't match the zip under any key this build trusts. */
  | 'bad-signature'
  /** The zip is damaged, holds an unsafe path or isn't a complete extension. */
  | 'bad-package'
  /** The zip's manifest names another version than the release. */
  | 'wrong-version'
  /** The new version has another `key`, so Chrome would see another extension and the data would stay behind. */
  | 'new-identity'
  /** Writing the files failed; the old ones were put back. */
  | 'write-failed'
  /** Writing failed and putting the old files back failed too; the backup is kept to try again. */
  | 'rollback-failed';

/** A one-click update that stopped, with the reason and, for the log, what the browser said. */
export class UpdateFailure extends Error {
  override name = 'UpdateFailure';

  /**
   * A failure for `problem`, with what the browser said.
   *
   * @param problem Why the update stopped.
   * @param detail What the browser or the check said, for the activity log; never shown alone.
   */
  constructor(
    readonly problem: UpdateProblem,
    readonly detail = '',
  ) {
    super(detail ? `${problem}: ${detail}` : problem);
  }
}

/** Where Chrome shows the folder an unpacked Xomoni was loaded from. */
const WHERE_FOLDER =
  'Chrome shows it on chrome://extensions: open Xomoni’s Details, and look under Source for where it was loaded from.';

/** What the dashboard says for `problem`, updating to `version` from `current`. */
export function problemText(problem: UpdateProblem, version: string, current: string): string {
  switch (problem) {
    case 'unsupported':
      return 'This browser can’t check the signature of a release (Chrome 137 or later can). Download the new version by hand, or update Chrome first.';
    case 'no-key':
      return 'This version of Xomoni can’t check releases yet. Download the new version by hand; the next ones can update in one click.';
    case 'not-zip':
      return 'This Xomoni came from a store, which updates it by itself.';
    case 'not-newer':
      return `Xomoni ${current} is already as new as ${version}.`;
    case 'busy':
      return 'A job is running. Xomoni updates only while no job runs: pause it, or wait until it ends, then update.';
    case 'no-folder':
      return 'Choose Xomoni’s folder first: the folder you loaded Xomoni from in Chrome.';
    case 'folder-denied':
      return 'Chrome didn’t let Xomoni change its folder, so nothing was changed. Choose the folder again and press Allow.';
    case 'needs-click':
      return 'Chrome wants a fresh click before it asks about Xomoni’s folder. Press Update now again.';
    case 'wrong-folder':
      return `The folder chosen doesn’t hold Xomoni ${current} any more. Choose the folder Chrome loads Xomoni from. ${WHERE_FOLDER}`;
    case 'download-denied':
      return 'Xomoni needs your OK to download its releases from GitHub. Nothing was changed.';
    case 'download-failed':
      return `Couldn’t download Xomoni ${version} from GitHub. Check the connection and try again. Nothing was changed.`;
    case 'unsigned':
      return `Xomoni ${version} on GitHub has no signature, so Xomoni won’t install it. Nothing was changed.`;
    case 'bad-signature':
      return `The download of Xomoni ${version} isn’t signed by Xomoni’s release key, so it was thrown away. Nothing was changed.`;
    case 'bad-package':
      return `The download of Xomoni ${version} isn’t a complete, safe Xomoni, so it was thrown away. Nothing was changed.`;
    case 'wrong-version':
      return `The download says it is another version than ${version}, so it was thrown away. Nothing was changed.`;
    case 'new-identity':
      return `Xomoni ${version} is a new extension to Chrome, so updating in place would leave your data behind. Export your data first (Settings › Move your data), then install ${version} by hand and import it there.`;
    case 'write-failed':
      return `Couldn’t write Xomoni ${version} into its folder, so the old files were put back. Xomoni ${current} keeps running.`;
    case 'rollback-failed':
      return `Couldn’t finish writing Xomoni ${version}, nor put every old file back. Press Put back ${current} to try again before you reload Xomoni.`;
  }
}
