const TWITTER_EPOCH = 1288834974657n;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Creation time encoded in a snowflake id (posts after Nov 2010), or null. */
export function snowflakeTime(id: string): number | null {
  if (!/^\d{15,20}$/.test(id)) return null;
  const ms = Number((BigInt(id) >> 22n) + TWITTER_EPOCH);
  return ms > 1288834974657 && ms < Date.now() + 86_400_000 ? ms : null;
}

/** Parses X's legacy date format: "Wed Oct 10 20:19:24 +0000 2018". */
export function parseTwitterDate(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^\w{3} (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/);
  if (!m) {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  const month = MONTHS.indexOf(m[1] ?? '');
  if (month < 0) return null;
  const offset = (m[6] === '-' ? -1 : 1) * (Number(m[7]) * 60 + Number(m[8])) * 60_000;
  return Date.UTC(Number(m[9]), month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) - offset;
}

/**
 * X never exposes when you liked something. Entries on the Likes timeline carry a
 * `sortIndex` that may be a snowflake minted at like time; accept it only when it
 * is plausible (not the post id itself, after the post existed, not in the future).
 */
export function estimateLikedAt(sortIndex: string | null, postId: string, postCreatedAt: number): number | null {
  if (!sortIndex || sortIndex === postId) return null;
  const t = snowflakeTime(sortIndex);
  if (t == null) return null;
  if (t < postCreatedAt - 60_000 || t > Date.now() + 60_000) return null;
  return t;
}

/** YYYY-MM-DD in UTC, as X search operators expect. */
export function searchDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** One day in ms. */
export const DAY = 86_400_000;
/** One hour in ms. */
export const HOUR = 3_600_000;

/** One minute in ms. */
export const MINUTE = 60_000;
