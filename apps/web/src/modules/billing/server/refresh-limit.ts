import 'server-only';
// *Refresh* asks Polar at most once a minute per person (#421, CB.2.4). Kept in this server instance's memory: enough
// to stop a person, or a stuck button, from pressing it again and again; Polar's own rate limits stand behind it.

/** How long a person waits between two refreshes. */
export const REFRESH_EVERY_MS = 60_000;

/** At most this many people are remembered; the oldest go first. */
const REMEMBERED = 10_000;

/** A limiter of one attempt per `everyMs` for each key, with the clock `now`. */
export function refreshLimiter(everyMs = REFRESH_EVERY_MS, now: () => number = Date.now) {
  const last = new Map<string, number>();
  return (key: string): boolean => {
    const at = now();
    const previous = last.get(key);
    if (previous !== undefined && at - previous < everyMs) return false;
    last.delete(key);
    last.set(key, at);
    if (last.size > REMEMBERED) last.delete(last.keys().next().value as string);
    return true;
  };
}
