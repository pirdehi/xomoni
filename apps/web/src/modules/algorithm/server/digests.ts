import 'server-only';
import { notFound } from 'next/navigation';
import { SITE_URL } from '@/shared/config/site';
import { E2E_DIGEST_FILES } from '../data/e2e';
import { DIGEST_FILES } from '../data/index';
import { isMonth, publishedDigests } from '../domain/digest';
import { type Digest, parseDigest } from '../domain/parse';

export type { Digest } from '../domain/parse';

/**
 * Whether this build shows the end-to-end tests' sample digests too: only when `XOMONI_E2E_DIGESTS` is `1`, as
 * `playwright.config.ts` sets it, and only on a local site, so a stray setting in Vercel can't publish them.
 */
export function showsSampleDigests(env: Record<string, string | undefined> = process.env, site = SITE_URL): boolean {
  return env.XOMONI_E2E_DIGESTS === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(site);
}

/**
 * Every digest file, checked (ADR-0046). A file that isn't a digest throws, naming it and what is wrong, so the build
 * fails rather than show it or skip it in silence. Two files of the same month throw too.
 */
export function readDigests(files: readonly unknown[] = DIGEST_FILES, samples = showsSampleDigests()): Digest[] {
  const all = samples ? [...files, ...E2E_DIGEST_FILES] : files;
  const digests = all.map((file, i) => {
    const read = parseDigest(file);
    if (!read.ok) throw new Error(`Digest file ${i + 1} is not a digest: ${read.problems.join('; ')}`);
    return read.digest;
  });
  const months = digests.map((d) => d.month);
  const repeated = months.find((month, i) => months.indexOf(month) !== i);
  if (repeated) throw new Error(`Two digest files are for ${repeated}.`);
  return digests;
}

/** The digests xomoni.com/algorithm lists: published ones only, newest first. */
export function digestList(): Digest[] {
  return publishedDigests(readDigests());
}

/** The published digest of `month`, or Next.js's 404 for a month with none, a draft, or an address that isn't a month. */
export function digestOr404(month: string): Digest {
  const digest = isMonth(month) ? digestList().find((d) => d.month === month) : undefined;
  if (!digest) notFound();
  return digest;
}

/** An address segment that is never a month, so its page is the 404: Next.js needs one to build the route by. */
export const NO_DIGEST = 'none';

/**
 * The months whose pages are built ahead, for `generateStaticParams`: every published digest's. With none yet, one
 * address that answers 404, since Cache Components need at least one to build the route.
 */
export function digestMonths(): string[] {
  const months = digestList().map((d) => d.month);
  return months.length ? months : [NO_DIGEST];
}
