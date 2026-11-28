'use client';
// xomoni.com/algorithm (#430, ADR-0046): what the digests are, what they can't tell, and every published one, newest
// first. Static and the same for every visitor: no cookie, no request, nothing about anyone.
import { makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import Link from 'next/link';
import { AREA_WORDS, DIGEST_REPO, dayLabel, digestHref, monthLabel } from '../domain/digest';
import type { Digest } from '../domain/parse';
import { DigestShell } from './digest-shell';

const useStyles = makeStyles({
  list: { listStyleType: 'none', padding: 0, margin: `${tokens.spacingVerticalM} 0 0` },
  item: {
    padding: `${tokens.spacingVerticalM} 0`,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    ':last-child': { borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}` },
  },
  month: { ...typographyStyles.subtitle2 },
  meta: { ...typographyStyles.body1, color: tokens.colorNeutralForeground3 },
});

/** The repository the digests read, on GitHub. */
const REPO_URL = `https://github.com/${DIGEST_REPO}`;

/** One line under a digest's month: how far it goes, how many commits, and the areas it touched. */
export function digestLine(digest: Digest): string {
  const areas = digest.areas.map(({ area }) => AREA_WORDS[area].label).join(', ');
  const commits = `${digest.commits} ${digest.commits === 1 ? 'commit' : 'commits'}`;
  return [`Up to ${dayLabel(digest.toDate)}`, commits, areas].filter(Boolean).join(' · ');
}

/** What every digest page says it can't tell: the weights are hidden, and nothing is about anyone's account. */
export const LIMITS_TEXT =
  'X hides the real weights. The public code shows how the system is built and what its settings are called, not ' +
  'the values X runs with, nor who sees which post. Nothing here is about your account.';

/** The list of published digests (`digests`, newest first), with what they are; an empty list says none is out yet. */
export function DigestList({ digests }: { digests: readonly Digest[] }) {
  const s = useStyles();
  return (
    <DigestShell
      eyebrow="Algorithm digest"
      title="X’s ranking code, month by month"
      lead="What changed each month in the code X publishes for its recommendations, in plain words, made from that public code only."
    >
      <h2>Digests</h2>
      {digests.length === 0 ? (
        <p>No digest is out yet. The first comes once a person has written it and checked it against the code.</p>
      ) : (
        <ul className={s.list} aria-label="Digests, newest first">
          {digests.map((digest) => (
            <li key={digest.month} className={s.item}>
              <Link href={digestHref(digest.month)} className={s.month}>
                {monthLabel(digest.month)}
              </Link>
              <p className={s.meta}>{digestLine(digest)}</p>
            </li>
          ))}
        </ul>
      )}

      <h2>How each digest is made</h2>
      <ul>
        <li>
          From one place only: X’s public repository <a href={REPO_URL}>{DIGEST_REPO}</a>, read through GitHub. No data
          about you or anyone else takes part, and these pages set no cookie.
        </li>
        <li>
          Each month, a workflow lists what changed: the commits, the parts of the code they touched and the settings
          whose names changed. A person then writes the summary, checks every claim against a file of X’s code, and
          publishes it.
        </li>
        <li>Each digest links the exact changes on GitHub, so you can read the code yourself.</li>
      </ul>

      <h2>What a digest can’t tell you</h2>
      <p>{LIMITS_TEXT}</p>
    </DigestShell>
  );
}
