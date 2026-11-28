import { describe, expect, it } from 'vitest';
import {
  AREAS,
  AREA_WORDS,
  DIGEST_LIMITS,
  DIGEST_REPO,
  compareUrl,
  dayLabel,
  digestHref,
  isMonth,
  monthLabel,
  paragraphs,
  publishedDigests,
  shortCommit,
} from './digest';
import { type Digest, parseDigest } from './parse';

const FROM = 'a'.repeat(40);
const TO = 'b'.repeat(40);
/** Characters no line from X's repository may hold: NUL, a tab, a newline, DEL, a C1 control, zero-width space, an RTL override, an isolate, a BOM. */
const UNSAFE = [0x00, 0x09, 0x0a, 0x7f, 0x85, 0x200b, 0x202e, 0x2066, 0xfeff].map((c) => String.fromCodePoint(c));

/** A digest file as the tool writes it, published, with the given changes. */
function file(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    month: '2026-11',
    repo: DIGEST_REPO,
    from: FROM,
    to: TO,
    toDate: '2026-11-21',
    status: 'published',
    summary: 'Ranking gained a scorer.\n\nA filter was removed.',
    commits: 20,
    files: 300,
    filesCapped: true,
    areas: [{ area: 'ranking', files: 102, paths: ['home-mixer/scorers/phoenix_scorer.rs'] }],
    parameters: ['rust_home_mixer_reply_weight'],
    parameterCount: 208,
    messages: ['Open-source X Recommendation Algorithm'],
    ...changes,
  };
}

/** The digest a file reads as, or a failure of the test. */
function read(changes: Record<string, unknown> = {}): Digest {
  const result = parseDigest(file(changes));
  if (!result.ok) throw new Error(result.problems.join('; '));
  return result.digest;
}

/** What `parseDigest` finds wrong with a file, as one line. */
function problems(value: unknown): string {
  const result = parseDigest(value);
  return result.ok ? '' : result.problems.join('; ');
}

describe('parseDigest (#430, ADR-0046)', () => {
  it('reads a file the tool wrote, published or a draft', () => {
    expect(read()).toEqual(file());
    expect(read({ status: 'draft', summary: '' }).status).toBe('draft');
    expect(read({ areas: [], parameters: [], parameterCount: 0, messages: [], files: 0 }).areas).toEqual([]);
  });

  it('refuses anything that isn’t an object of the exact shape', () => {
    for (const value of [null, undefined, 'text', 3, [], {}]) expect(problems(value)).not.toBe('');
    expect(problems({ ...file(), extra: 'field' })).toMatch(/extra/);
    const { summary: _summary, ...missing } = file();
    expect(problems(missing)).toMatch(/summary/);
    expect(problems(file({ areas: [{ area: 'ranking', files: 1, paths: [], note: 'x' }] }))).toMatch(/areas/);
  });

  it('refuses a wrong version, repository, month, commit or day', () => {
    expect(problems(file({ version: 2 }))).toMatch(/version/);
    expect(problems(file({ repo: 'someone/else' }))).toMatch(/repo/);
    for (const month of ['2026-13', '2026-00', '26-11', '2026-1', '2026-11-01', '../x'])
      expect(problems(file({ month }))).toMatch(/month/);
    for (const sha of ['abc1234', TO.toUpperCase(), `${TO}0`, 'g'.repeat(40)])
      expect(problems(file({ to: sha }))).toMatch(/to/);
    expect(problems(file({ to: FROM }))).toMatch(/same commit/);
    expect(problems(file({ toDate: '2026-02-30' }))).toMatch(/toDate/);
    expect(problems(file({ toDate: '21/11/2026' }))).toMatch(/toDate/);
  });

  it('refuses an unknown status, a published digest with no summary, and a summary that is too long', () => {
    expect(problems(file({ status: 'public' }))).toMatch(/status/);
    expect(problems(file({ summary: '   ' }))).toMatch(/no summary/);
    expect(problems(file({ summary: 'x'.repeat(DIGEST_LIMITS.summary + 1) }))).toMatch(/2,000/);
    expect(read({ summary: 'x'.repeat(DIGEST_LIMITS.summary) }).summary).toHaveLength(DIGEST_LIMITS.summary);
    expect(problems(file({ summary: `one${UNSAFE[0]}two` }))).toMatch(/control/);
  });

  it('refuses counts that aren’t counts', () => {
    expect(problems(file({ commits: 0 }))).toMatch(/commits/);
    expect(problems(file({ files: 1.5 }))).toMatch(/files/);
    expect(problems(file({ filesCapped: 'yes' }))).toMatch(/filesCapped/);
    expect(problems(file({ parameterCount: 0 }))).toMatch(/fewer than its names/);
  });

  it('refuses an unknown or repeated area, and file names past their limits', () => {
    expect(problems(file({ areas: [{ area: 'secret', files: 1, paths: [] }] }))).toMatch(/areas/);
    const twice = [
      { area: 'ranking', files: 1, paths: [] },
      { area: 'ranking', files: 2, paths: [] },
    ];
    expect(problems(file({ areas: twice }))).toMatch(/repeated/);
    expect(problems(file({ areas: [{ area: 'ranking', files: 0, paths: [] }] }))).toMatch(/files/);
    const eleven = Array.from({ length: DIGEST_LIMITS.paths + 1 }, (_, i) => `p${i}.rs`);
    expect(problems(file({ areas: [{ area: 'ranking', files: 11, paths: eleven }] }))).toMatch(/paths/);
  });

  it('refuses text from X’s repository that the tool would have cleaned: unsafe characters, spaces at an end, too long', () => {
    for (const char of UNSAFE) {
      expect(problems(file({ messages: [`a${char}b`] })), `U+${char.codePointAt(0)!.toString(16)}`).toMatch(
        /control or direction/,
      );
      expect(problems(file({ areas: [{ area: 'docs', files: 1, paths: [`a${char}.md`] }] }))).not.toBe('');
    }
    expect(problems(file({ messages: [' padded'] }))).toMatch(/space/);
    expect(problems(file({ messages: [''] }))).toMatch(/messages/);
    expect(problems(file({ messages: ['x'.repeat(DIGEST_LIMITS.text + 1)] }))).toMatch(/200/);
    expect(read({ messages: ['x'.repeat(DIGEST_LIMITS.text)] }).messages[0]).toHaveLength(DIGEST_LIMITS.text);
    const many = Array.from({ length: DIGEST_LIMITS.messages + 1 }, (_, i) => `m${i}`);
    expect(problems(file({ messages: many }))).toMatch(/messages/);
  });

  it('keeps markup as plain text: it is a valid line, which the pages show as text', () => {
    const markup = '<script>alert(1)</script><img src=x onerror=alert(1)>';
    expect(read({ messages: [markup] }).messages).toEqual([markup]);
  });

  it('refuses parameter names that aren’t names, and more than 50', () => {
    for (const name of ['<b>', 'a', '1abc', 'with space', 'x'.repeat(81)])
      expect(problems(file({ parameters: [name], parameterCount: 1 }))).toMatch(/parameters/);
    const names = Array.from({ length: DIGEST_LIMITS.parameters + 1 }, (_, i) => `name_${i}`);
    expect(problems(file({ parameters: names, parameterCount: 60 }))).toMatch(/parameters/);
  });
});

describe('publishedDigests', () => {
  it('keeps published digests only, newest month first', () => {
    const digests = [
      read({ month: '2026-05' }),
      read({ month: '2026-11', status: 'draft', summary: '' }),
      read({ month: '2026-08' }),
      read({ month: '2026-01' }),
    ];
    expect(publishedDigests(digests).map((d) => d.month)).toEqual(['2026-08', '2026-05', '2026-01']);
    expect(publishedDigests([])).toEqual([]);
    expect(publishedDigests([read({ status: 'draft', summary: '' })])).toEqual([]);
  });
});

describe('the words of the pages', () => {
  it('names each area with a sentence on what it does', () => {
    expect(Object.keys(AREA_WORDS)).toEqual([...AREAS]);
    for (const area of AREAS) {
      expect(AREA_WORDS[area].label).not.toBe('');
      expect(AREA_WORDS[area].about).toMatch(/\.$/);
    }
  });

  it('writes months and days in words, in UTC as the repository dates them', () => {
    expect(monthLabel('2026-11')).toBe('November 2026');
    expect(monthLabel('2000-01')).toBe('January 2000');
    expect(dayLabel('2026-11-01')).toBe('November 1, 2026');
    expect(dayLabel('2026-02-28')).toBe('February 28, 2026');
  });

  it('tells a month’s address from anything else', () => {
    expect(isMonth('2026-11')).toBe(true);
    for (const text of ['2026-13', 'none', '2026-1', '', '2026-11/..', '2026-11 ']) expect(isMonth(text)).toBe(false);
    expect(digestHref('2026-11')).toBe('/algorithm/2026-11');
  });

  it('links the exact range on GitHub, and shortens commits as GitHub does', () => {
    expect(compareUrl({ from: FROM, to: TO })).toBe(`https://github.com/xai-org/x-algorithm/compare/${FROM}...${TO}`);
    expect(shortCommit(TO)).toBe('bbbbbbb');
  });

  it('splits the summary into paragraphs at blank lines', () => {
    expect(paragraphs('One.\n\nTwo,\nstill two.\n \n\nThree.')).toEqual(['One.', 'Two,\nstill two.', 'Three.']);
    expect(paragraphs('')).toEqual([]);
  });
});
