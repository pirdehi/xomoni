// *Send to my computer* (ADR-0027, #243): Xomoni runs only on a computer, so on a phone the site offers to get a link
// there. Pure: which ways this browser offers, best first (its share sheet, else copying the link, else an email to
// oneself), and the words that go with the link. The link goes as it is given: nothing is added to it, and nothing
// reaches a server.

/** A way to get a link to the person's computer: the share sheet, the clipboard, or an email to oneself. */
export type SendWay = 'share' | 'copy' | 'email';

/** What this browser can do with a link: share it (`navigator.share`) and copy it (`navigator.clipboard.writeText`). */
export interface SendAbilities {
  share: boolean;
  copy: boolean;
}

/**
 * The ways to try, in order: the share sheet where there is one, then copying where the clipboard is there, then an
 * email, which every browser can open. The first is the one offered; each next one is tried only when the one before
 * failed, never when the person closed the share sheet (that was their choice).
 */
export function sendWays(abilities: SendAbilities): SendWay[] {
  const ways: SendWay[] = [];
  if (abilities.share) ways.push('share');
  if (abilities.copy) ways.push('copy');
  ways.push('email');
  return ways;
}

/** The way offered first (the first of `sendWays`): the share sheet, else copying, else an email. */
export function firstSendWay(abilities: SendAbilities): SendWay {
  if (abilities.share) return 'share';
  return abilities.copy ? 'copy' : 'email';
}

/** What the share sheet carries besides the link: the app the person picks may use the title as a subject. */
export const SHARE_TITLE = 'Xomoni';

/** The line the share sheet puts before the link. */
export const SHARE_TEXT = 'Open Xomoni on my computer';

/** What `navigator.share` is given: the title, the line and the link, unchanged. */
export function shareData(url: string): { title: string; text: string; url: string } {
  return { title: SHARE_TITLE, text: SHARE_TEXT, url };
}

/** The subject of the email to oneself. */
export const EMAIL_SUBJECT = 'Open Xomoni on my computer';

/** The body of the email to oneself: why, then the link on its own line, so mail apps make it clickable. */
export function emailBody(url: string): string {
  return `Xomoni runs on a computer. Open this link there:\r\n\r\n${url}\r\n`;
}

/**
 * A `mailto:` link that opens the person's own mail app with the subject and body filled in (RFC 6068). It names no
 * recipient, so the person writes to themselves, and nothing else is added: no address of ours, no tracking.
 */
export function mailtoHref(url: string): string {
  return `mailto:?subject=${encodeURIComponent(EMAIL_SUBJECT)}&body=${encodeURIComponent(emailBody(url))}`;
}

/** What happened the last time: shared, copied, or only an email is left (sharing and copying failed). */
export type SendResult = 'shared' | 'copied' | 'email';

/** What the page says after each result. For `email`, the page adds the link to the email. */
export const SEND_RESULT_TEXT: Record<SendResult, string> = {
  shared: 'Sent. Open the link on your computer.',
  copied: 'Link copied. Paste it into a note or a message to yourself, and open it on your computer.',
  email: 'Couldn’t share or copy the link here.',
};
