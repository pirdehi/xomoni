/** Reads the emails the local Supabase stack sent, from Mailpit's API. */

interface Summary {
  ID: string;
  Subject: string;
  Created: string;
}

const base = () => process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

/** All messages sent to `address` with a subject containing `subject`, oldest first. */
export async function emailsTo(address: string, subject: string): Promise<Summary[]> {
  const url = `${base()}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=50`;
  const { messages } = (await (await fetch(url)).json()) as { messages: Summary[] };
  return messages.filter((m) => m.Subject.includes(subject)).sort((a, b) => a.Created.localeCompare(b.Created));
}

/** Waits until at least `count` matching messages arrived, then returns the newest one's HTML and sender. */
export async function waitForEmail(
  address: string,
  subject: string,
  count = 1,
): Promise<{ html: string; from: string; subject: string }> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const found = await emailsTo(address, subject);
    const latest = found.length >= count ? found[found.length - 1] : undefined;
    if (latest) {
      const message = (await (await fetch(`${base()}/api/v1/message/${latest.ID}`)).json()) as {
        HTML: string;
        Subject: string;
        From: { Address: string; Name: string };
      };
      return { html: message.HTML, from: `${message.From.Name} <${message.From.Address}>`, subject: message.Subject };
    }
    if (Date.now() > deadline) throw new Error(`No email "${subject}" #${count} for ${address}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** The `/auth/confirm` link in an email's HTML, as a path relative to the site. */
export function confirmLink(html: string): string {
  const href = /href="([^"]*\/auth\/confirm\?[^"]+)"/.exec(html)?.[1];
  if (!href) throw new Error('No /auth/confirm link in the email');
  const url = new URL(href.replaceAll('&amp;', '&'));
  return `${url.pathname}${url.search}`;
}
