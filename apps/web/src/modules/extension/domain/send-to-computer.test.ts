import { describe, expect, it } from 'vitest';
import {
  EMAIL_SUBJECT,
  SEND_RESULT_TEXT,
  SHARE_TEXT,
  SHARE_TITLE,
  emailBody,
  firstSendWay,
  mailtoHref,
  sendWays,
  shareData,
} from './send-to-computer';

const LINK = 'https://xomoni.com/install';

describe('sendWays (#243)', () => {
  it('offers the share sheet first, then copying, then an email, when the browser has both', () => {
    expect(sendWays({ share: true, copy: true })).toEqual(['share', 'copy', 'email']);
    expect(firstSendWay({ share: true, copy: true })).toBe('share');
  });

  it('copies first without a share sheet', () => {
    expect(sendWays({ share: false, copy: true })).toEqual(['copy', 'email']);
    expect(firstSendWay({ share: false, copy: true })).toBe('copy');
  });

  it('falls back to an email straight after the share sheet when there is no clipboard', () => {
    expect(sendWays({ share: true, copy: false })).toEqual(['share', 'email']);
    expect(firstSendWay({ share: true, copy: false })).toBe('share');
  });

  it('offers only an email when the browser can neither share nor copy', () => {
    expect(sendWays({ share: false, copy: false })).toEqual(['email']);
    expect(firstSendWay({ share: false, copy: false })).toBe('email');
  });

  it('always ends with the email, which every browser can open, and offers the first of them', () => {
    for (const share of [true, false])
      for (const copy of [true, false]) {
        const ways = sendWays({ share, copy });
        expect(ways.at(-1)).toBe('email');
        expect(firstSendWay({ share, copy })).toBe(ways[0]);
      }
  });
});

describe('what goes with the link', () => {
  it('shares the link exactly as given, with a title and a line', () => {
    expect(shareData(LINK)).toEqual({ title: SHARE_TITLE, text: SHARE_TEXT, url: LINK });
    expect(SHARE_TEXT).toBe('Open Xomoni on my computer');
  });

  it('writes the email with the link on its own line', () => {
    expect(emailBody(LINK)).toBe(
      'Xomoni runs on a computer. Open this link there:\r\n\r\nhttps://xomoni.com/install\r\n',
    );
  });

  it('opens the person’s own mail app with no recipient, the subject and the body, and nothing else', () => {
    const href = mailtoHref(LINK);
    expect(href.startsWith('mailto:?')).toBe(true);
    const params = new URLSearchParams(href.slice('mailto:?'.length));
    expect([...params.keys()]).toEqual(['subject', 'body']);
    expect(params.get('subject')).toBe(EMAIL_SUBJECT);
    expect(params.get('body')).toBe(emailBody(LINK));
    // The link inside is the one given: no address of ours, no tracking added.
    expect(params.get('body')).toContain(`${LINK}\r\n`);
    expect(href).not.toMatch(/utm_|ref=|@/);
  });

  it('encodes what a mail app would otherwise cut, such as an ampersand in a page’s address', () => {
    const plan = 'https://xomoni.com/dashboard/cleanup?what=like&before=2020-01-01#top';
    const href = mailtoHref(plan);
    expect(href).not.toContain('&before');
    expect(href).not.toContain('#top');
    expect(new URLSearchParams(href.slice('mailto:?'.length)).get('body')).toContain(plan);
  });

  it('says what happened after each way', () => {
    expect(SEND_RESULT_TEXT).toEqual({
      shared: 'Sent. Open the link on your computer.',
      copied: 'Link copied. Paste it into a note or a message to yourself, and open it on your computer.',
      email: 'Couldn’t share or copy the link here.',
    });
  });
});
