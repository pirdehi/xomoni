// The weekly email's stop link (#257, ADR-0031): the token every email carries, checked before anything is asked, and
// how a mail app's own *Unsubscribe* button calls it (RFC 8058). Pure.

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The stop token in a link, lowercased; null when the link carries none, or not one Xomoni could have made. */
export function stopToken(raw: string | null): string | null {
  const token = raw?.trim() ?? '';
  return TOKEN.test(token) ? token.toLowerCase() : null;
}

/** Whether a POST's body is a mail app's one-click stop: `List-Unsubscribe=One-Click` (RFC 8058). */
export function isOneClick(body: string): boolean {
  return new URLSearchParams(body).get('List-Unsubscribe') === 'One-Click';
}

/** Where the stop page sends the person, and what it says: asked, stopped, or what went wrong. */
export type StopState = 'ask' | 'stopped' | 'failed' | 'invalid';

/** The stop page's state from its address. */
export function stopState(params: {
  token?: string | null;
  stopped?: string | null;
  failed?: string | null;
}): StopState {
  if (params.stopped === '1') return 'stopped';
  if (!stopToken(params.token ?? null)) return 'invalid';
  return params.failed === '1' ? 'failed' : 'ask';
}
