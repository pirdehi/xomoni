// What xomoni.com says about the extension's newest release (#151), from its answer to each status report. A zip
// install never updates by itself until the Chrome Web Store ships updates (#43), so the dashboard says when a
// newer version is out. Only connected browsers hear it; nothing is asked of any other server.
import { kvGet, kvSet } from '../shared/db';
import { asObject, asString } from '../shared/json';
import { isNewer, isVersion } from '../shared/version';

/** Where releases are published, with their checksums and provenance (docs/RELEASING.md). */
export const RELEASES_URL = 'https://github.com/pirdehi/xomoni/releases/latest';

/** The `kv` keys: the last answer, and the version whose notice the person dismissed. */
const NEWS_KEY = 'releaseNews';
const DISMISSED_KEY = 'releaseDismissed';

/** The newest release, and whether any release newer than this browser's version fixes a vulnerability. */
export interface ReleaseNews {
  latest: string;
  security: boolean;
}

/** The answer of `device_report` as release news, or null when it carries none a version can be read from. */
export function parseReleaseNews(value: unknown): ReleaseNews | null {
  const answer = asObject(value);
  const latest = asString(answer?.latest);
  if (!isVersion(latest)) return null;
  return { latest, security: answer?.security === true };
}

/** Keeps the last answer for the dashboard. */
export function saveReleaseNews(news: ReleaseNews): Promise<void> {
  return kvSet(NEWS_KEY, news);
}

/** The notice the dashboard shows: a newer version, and whether it fixes a vulnerability. */
export interface UpdateNotice {
  version: string;
  security: boolean;
}

/**
 * The notice for this browser's `current` version, or null when it is up to date or the person dismissed this
 * version. A release that fixes a vulnerability can't be dismissed.
 */
export function updateNotice(news: ReleaseNews | null, current: string, dismissed: string | null): UpdateNotice | null {
  if (!news || !isNewer(news.latest, current)) return null;
  if (!news.security && dismissed === news.latest) return null;
  return { version: news.latest, security: news.security };
}

/** The notice to show now, from what is stored. */
export async function currentUpdateNotice(current: string): Promise<UpdateNotice | null> {
  const news = parseReleaseNews(await kvGet<unknown>(NEWS_KEY, null));
  const dismissed = await kvGet<unknown>(DISMISSED_KEY, null);
  return updateNotice(news, current, typeof dismissed === 'string' ? dismissed : null);
}

/** Hides the notice for `version` until a newer one is out. */
export function dismissUpdate(version: string): Promise<void> {
  return kvSet(DISMISSED_KEY, version);
}
