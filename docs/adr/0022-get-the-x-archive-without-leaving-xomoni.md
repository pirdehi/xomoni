# ADR-0022: Get X's archive without leaving Xomoni: X's own page, the person's password on X, the ZIP read here

- Status: Accepted
- Date: 2026-11-08

## Context

X's archive is the only complete copy of an account (PLAYBOOK E2, E8). Getting it into Xomoni took more than ten steps by hand:
- find X's settings, type the password, request the archive;
- wait 24 to 72 hours for an email;
- download the ZIP, unzip it, find its `data` folder;
- come back to Xomoni and choose that folder.

The maintainer asked for this to work the way a cleanup does: Xomoni does the work, and the person only steps in where only they can (#184 to #187).

The fixed constraints:
- X asks for the password, and sometimes a code, before it makes an archive. Xomoni never handles X's password ([ADR-0003](0003-no-credentials-no-evasion.md)).
- Xomoni acts on X only through X's own page and never sends requests to X itself ([ADR-0002](0002-drive-x-ui-not-the-api.md)).
- X data stays in the browser ([ADR-0004](0004-x-data-stays-local.md)).
- The extension asks for no host permissions (#143).

## Decision

1. **The ZIP is read as it is (#184).** Xomoni reads X's ZIP in place, in the dashboard: only its central directory and the entries it imports (`account.js`, `tweets*.js`, `like*.js`), through `Blob.slice`, inflated by the browser's `DecompressionStream`.
   - Photos, videos and messages are never read.
   - A damaged or hostile ZIP is refused before anything is imported: encryption, unknown methods, sizes that lie, a bad CRC, or records outside the file.
2. **The Downloads folder, read-only, only if the person chooses it (#187).**
   - The person may choose their Downloads folder once, with the browser's own folder picker (File System Access, read-only; no extension permission).
   - Xomoni then looks there, while the Library is open, for files named like X's archive (`twitter-YYYY-MM-DD-….zip`). It opens no other file, and imports each one once.
   - The folder handle stays in this browser's database and is forgotten by *Stop* or by wiping local data.
3. **X's archive page is driven like any other X page (#186).** Requesting and downloading the archive is a job in the worker window, on `x.com/settings/download_your_data`:
   - Xomoni presses X's own *Request archive* and *Download archive* buttons, as it presses Delete. It presses only a button it recognizes, and never one it isn't sure of.
   - When X asks for the password or a code, the job waits as *Needs you*. The person types it on X; Xomoni never reads, stores or fills it.
   - While X prepares the archive, the job checks the page now and then within active hours, and says when it is ready.
   - The download is the browser's own, from X's button. Xomoni never fetches the file itself, and asks for no host permission to do so.
4. **The person can always do it by hand.** The link to X's page, the drop zone and the ZIP picker stay. Anything the job can't recognize falls back to them.

## Consequences

- Getting the archive needs the person only for X's password, typed on X, and optionally for choosing Downloads once.
- X can change its archive page; its selectors live with the others in `content/dom.ts` (PLAYBOOK F1), and the job asks the person whenever the page isn't what it expects.
- Importing a large archive reads tens of megabytes, not gigabytes, since media is skipped.
- Chrome may ask again before Xomoni reads the Downloads folder in a later visit; that takes one click.

## Alternatives considered

- **Xomoni downloads the ZIP itself, reading only the text part through HTTP ranges:** the fastest, but it sends requests to X and needs a host permission (ADR-0002, #143). Not now.
- **xomoni.com fetches the archive:** X data would reach a server (ADR-0004).
- **X's official API:** it has no archive endpoint and is paid.
- **"Allow access to file URLs", or a native helper app:** far wider access than one folder, and an extra install.
