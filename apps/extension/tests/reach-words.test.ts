import { REACH_VERDICT_WORDS, usesBannedReachWord } from '@xomoni/bridge';
import { describe, expect, it } from 'vitest';
import { formatOf } from '../src/shared/vault/reach-stats';

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
    expect(Object.keys(SOURCES)).toContain('../src/shared/vault/reach-stats.ts');
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

  it('nor do the verdicts both apps show', () => {
    expect(Object.values(REACH_VERDICT_WORDS).filter(usesBannedReachWord)).toEqual([]);
    // The verdicts are words, not formats: a format is never shown as a verdict.
    expect(Object.keys(REACH_VERDICT_WORDS)).not.toContain(formatOf({ kind: 'reply' }));
  });
});
