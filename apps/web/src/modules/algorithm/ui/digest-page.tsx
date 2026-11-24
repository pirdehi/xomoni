'use client';
// One month's digest at xomoni.com/algorithm/<yyyy-mm> (#430, ADR-0046): the maintainer's summary, what it can't tell,
// the areas of the code that changed with some of their files, the parameters by name, and X's commit messages. Every
// word from X's repository is rendered as React text, never as HTML, so markup in a commit message shows as written.
import { makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import Link from 'next/link';
import { AREA_WORDS, compareUrl, dayLabel, monthLabel, paragraphs, shortCommit } from '../domain/digest';
import type { Digest } from '../domain/parse';
import { LIMITS_TEXT } from './digest-list';
import { DigestShell } from './digest-shell';

const useStyles = makeStyles({
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: tokens.spacingVerticalM,
    fontSize: tokens.fontSizeBase300,
    '& th, & td': {
      textAlign: 'left',
      verticalAlign: 'top',
      padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
      borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    },
    '& thead th': { ...typographyStyles.body1Strong, color: tokens.colorNeutralForeground1 },
    '& tbody th': { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1 },
  },
  about: { display: 'block', fontWeight: tokens.fontWeightRegular, color: tokens.colorNeutralForeground3 },
  paths: { listStyleType: 'none', margin: 0, padding: 0, '& li + li': { marginTop: tokens.spacingVerticalXXS } },
  caption: {
    ...typographyStyles.caption1,
    captionSide: 'bottom',
    textAlign: 'left',
    paddingTop: tokens.spacingVerticalS,
  },
  links: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXL}`,
    marginTop: tokens.spacingVerticalXXL,
  },
});

/** The line under the title: the range by its short commit ids, how far it goes, and how much changed. */
export function rangeLine(digest: Digest): string {
  const commits = `${digest.commits} ${digest.commits === 1 ? 'commit' : 'commits'}`;
  const files = `${digest.files} ${digest.files === 1 ? 'file' : 'files'}`;
  return (
    `From commit ${shortCommit(digest.from)} to ${shortCommit(digest.to)}, up to ${dayLabel(digest.toDate)}: ` +
    `${commits}, ${files} changed.`
  );
}

/** A published digest's page. Its text is the maintainer's; the rest comes from X's repository, as text. */
export function DigestPage({ digest }: { digest: Digest }) {
  const s = useStyles();
  const more = digest.parameterCount - digest.parameters.length;
  return (
    <DigestShell
      eyebrow="Algorithm digest"
      title={`What changed in X’s ranking code: ${monthLabel(digest.month)}`}
      lead={rangeLine(digest)}
    >
      <h2>Summary</h2>
      {paragraphs(digest.summary).map((text, i) => (
        <p key={i}>{text}</p>
      ))}

      <h2>What this can’t tell you</h2>
      <p>{LIMITS_TEXT}</p>

      <h2>Where the code changed</h2>
      {digest.areas.length === 0 ? (
        <p>GitHub listed no file for this range.</p>
      ) : (
        <table className={s.table}>
          {digest.filesCapped && (
            <caption className={s.caption}>
              GitHub lists 300 files at most, so the counts stop there: more may have changed.
            </caption>
          )}
          <thead>
            <tr>
              <th scope="col">Part of the code</th>
              <th scope="col">Files</th>
              <th scope="col">Some of them</th>
            </tr>
          </thead>
          <tbody>
            {digest.areas.map(({ area, files, paths }) => (
              <tr key={area}>
                <th scope="row">
                  {AREA_WORDS[area].label}
                  <span className={s.about}>{AREA_WORDS[area].about}</span>
                </th>
                <td>{files}</td>
                <td>
                  <ul className={s.paths}>
                    {paths.map((path) => (
                      <li key={path}>
                        <code>{path}</code>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Parameters that changed</h2>
      {digest.parameters.length === 0 ? (
        <p>No parameter’s definition changed in this range.</p>
      ) : (
        <>
          <p>By name only: the values in the public code aren’t the ones X runs with.</p>
          <ul aria-label="Parameters">
            {digest.parameters.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
          {more > 0 && <p>And {more} more.</p>}
        </>
      )}

      <h2>Commit messages</h2>
      {digest.messages.length === 0 ? (
        <p>None.</p>
      ) : (
        <>
          <p>As X wrote them, first line only.</p>
          <ul aria-label="Commit messages">
            {digest.messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </>
      )}

      <p className={s.links}>
        <a href={compareUrl(digest)} target="_blank" rel="noopener noreferrer">
          See every change on GitHub
        </a>
        <Link href="/algorithm">All digests</Link>
      </p>
    </DigestShell>
  );
}
