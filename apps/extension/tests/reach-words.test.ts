import { REACH_VERDICT_WORDS, usesBannedReachWord } from '@xomoni/bridge';
import { describe, expect, it } from 'vitest';
import { LABEL_GLOSSARY } from '../src/shared/vault/label-glossary';
import { formatOf } from '../src/shared/vault/reach-stats';
import { GUESS_NOTICE, SUSPECT_WHY_WORDS } from '../src/shared/vault/suspects';
import { UNDER_THE_HOOD_PROBLEMS, labelEventWords } from '../src/shared/vault/under-the-hood';

/**
 * Every file of Reach, as text: its model and its page. A file added to these folders is searched without changing
 * this test (ADR-0045, point 3).
 */
const SOURCES = import.meta.glob<string>(
  [
    '../src/shared/vault/{under-the-hood,label-glossary,reach,reach-stats,suspects}.ts',
    '../src/ui/pages/Reach.tsx',
    '../src/ui/components/reach/*.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
);

/** `source` without its comments, which may name the banned words to forbid them. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('no text of Reach says a post or an account is banned (ADR-0045, point 3)', () => {
  it('searches the files of Reach', () => {
    expect(Object.keys(SOURCES).sort()).toEqual(
      ['label-glossary', 'reach', 'reach-stats', 'suspects', 'under-the-hood']
        .map((f) => `../src/shared/vault/${f}.ts`)
        .sort(),
    );
  });

  it.each(Object.entries(SOURCES))('%s uses none of the words', (_, source) => {
    const lines = withoutComments(source)
      .split('\n')
      .filter((line) => usesBannedReachWord(line));
    expect(lines).toEqual([]);
  });

  it('finds a banned word in a file’s text, but not in its comments or a link', () => {
    const file = [
      '// Never says "shadowbanned".',
      '/* nor penalized */',
      "const source = 'https://example.com/shadowban-checker';",
      "const title = 'Your reach';",
    ].join('\n');
    expect(withoutComments(file).split('\n').filter(usesBannedReachWord)).toEqual([]);
    expect(usesBannedReachWord(withoutComments("const title = 'Your post was throttled';"))).toBe(true);
  });

  it('nor do the words Reach builds: problems, the glossary, the timeline’s events and the guesses', () => {
    const words = [
      ...Object.values(UNDER_THE_HOOD_PROBLEMS),
      ...LABEL_GLOSSARY.flatMap((e) => [e.meaning, e.effect, e.sourceName, e.source]),
      ...(['posts', 'account', 'unknown'] as const).map((scope) =>
        labelEventWords({ name: 'SPAM_HIGH_RECALL', scope, count: 2, before: 0 }, '2026-07'),
      ),
      GUESS_NOTICE,
      ...Object.values(SUSPECT_WHY_WORDS),
    ];
    expect(words.filter(usesBannedReachWord)).toEqual([]);
    // Where X names a label, Reach shows X's name: the rule is for Xomoni's own words.
    expect(labelEventWords({ name: 'THROTTLED_BY_X', scope: 'posts', count: 1, before: 0 }, '2026-07')).toBe(
      'X applied THROTTLED_BY_X to 1 post in July 2026',
    );
  });

  it('nor do the verdicts both apps show', () => {
    expect(Object.values(REACH_VERDICT_WORDS).filter(usesBannedReachWord)).toEqual([]);
    // The verdicts are words, not formats: a format is never shown as a verdict.
    expect(Object.keys(REACH_VERDICT_WORDS)).not.toContain(formatOf({ kind: 'reply' }));
  });
});
