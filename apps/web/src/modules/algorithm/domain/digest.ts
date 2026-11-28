// The monthly digest of X's open ranking code (#430, ADR-0046): its areas, limits and the words the pages use. A digest
// is drafted by `tooling/algorithm-digest.mjs` from X's public repository and published by a maintainer; `parse.ts`
// checks each file strictly before any page shows it. This file holds no schema, so the pages' browser code carries no
// zod: the site's Content-Security-Policy refuses the `new Function` zod would probe for (ADR-0014). Pure.

/** The one repository a digest is made from. */
export const DIGEST_REPO = 'xai-org/x-algorithm';

/** The limits of a digest, the same as the tool's (`tooling/algorithm-digest-lib.mjs`). */
export const DIGEST_LIMITS = {
  /** Characters of one commit message, file name or parameter name. */
  text: 200,
  /** Commit messages. */
  messages: 20,
  /** Parameter names. */
  parameters: 50,
  /** File names for each area. */
  paths: 10,
  /** Characters of the maintainer's summary. */
  summary: 2000,
} as const;

/** The areas of X's code a digest sorts changed files into, in the order a digest lists them. */
export const AREAS = [
  'ranking',
  'filters',
  'candidate-sources',
  'ads-blending',
  'content-understanding',
  'parameters',
  'docs',
  'other',
] as const;

/** One area of X's code. */
export type Area = (typeof AREAS)[number];

/** What each area is called on the page, and one sentence on what its code does. */
export const AREA_WORDS: Record<Area, { label: string; about: string }> = {
  ranking: { label: 'Ranking', about: 'The models and scorers that order the posts a timeline may show.' },
  filters: {
    label: 'Filters',
    about: 'What removes or limits a post or an account: visibility rules, safety labels and enforcement.',
  },
  'candidate-sources': {
    label: 'Candidate sources',
    about: 'Where the posts a timeline starts from come from, and the details added to them before ranking.',
  },
  'ads-blending': { label: 'Ads blending', about: 'How and where ads are placed among the posts.' },
  'content-understanding': {
    label: 'Content understanding',
    about: 'The models that read what a post, an image or a video is about.',
  },
  parameters: { label: 'Parameters', about: 'The settings and switches that tune the rest, by name.' },
  docs: { label: 'Documentation', about: 'The repository’s own explanations.' },
  other: { label: 'Other', about: 'Code the digest’s rules don’t place, such as servers, clients and tools.' },
};

/** The digests the website shows: published ones only, newest month first. A draft is never shown. */
export function publishedDigests<T extends { status: string; month: string }>(digests: readonly T[]): T[] {
  return digests.filter((d) => d.status === 'published').sort((a, b) => b.month.localeCompare(a.month));
}

/** Whether `text` names a month as a digest's address does, `yyyy-mm`. */
export function isMonth(text: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text);
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A digest's month in words: `2026-11` is *November 2026*. */
export function monthLabel(month: string): string {
  const [year, number] = month.split('-');
  return `${MONTH_NAMES[Number(number) - 1] ?? month} ${year}`;
}

/** A day in words, in UTC as the repository's dates are: `2026-11-21` is *November 21, 2026*. */
export function dayLabel(day: string): string {
  const [year, month, date] = day.split('-');
  return `${MONTH_NAMES[Number(month) - 1] ?? month} ${Number(date)}, ${year}`;
}

/** The first 7 characters of a commit id, as GitHub shows it. */
export function shortCommit(sha: string): string {
  return sha.slice(0, 7);
}

/** The digest's range on GitHub, for anyone to read the code it is made from. */
export function compareUrl(digest: { from: string; to: string }): string {
  return `https://github.com/${DIGEST_REPO}/compare/${digest.from}...${digest.to}`;
}

/** The summary's paragraphs: separated by a blank line, each trimmed, empty ones dropped. */
export function paragraphs(summary: string): string[] {
  return summary
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/** The address of a digest's page. */
export function digestHref(month: string): string {
  return `/algorithm/${month}`;
}
