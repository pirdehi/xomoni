import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavigationThrow } from '@test/fakes/navigation';
import { E2E_DIGEST_FILES } from '../data/e2e';
import { DIGEST_FILES } from '../data/index';
import { NO_DIGEST, digestList, digestMonths, digestOr404, readDigests, showsSampleDigests } from './digests';

const FROM = 'a'.repeat(40);
const TO = 'b'.repeat(40);

/** A digest file of `month`, published unless told otherwise. */
const file = (month: string, changes: Record<string, unknown> = {}) => ({
  version: 1,
  month,
  repo: 'xai-org/x-algorithm',
  from: FROM,
  to: TO,
  toDate: `${month}-20`,
  status: 'published',
  summary: 'Plain words.',
  commits: 1,
  files: 1,
  filesCapped: false,
  areas: [{ area: 'ranking', files: 1, paths: ['home-mixer/scorers/a.rs'] }],
  parameters: [],
  parameterCount: 0,
  messages: ['A change'],
  ...changes,
});

/** Whether `work` ends in Next.js's 404. */
function is404(work: () => unknown): boolean {
  try {
    work();
    return false;
  } catch (error) {
    if (error instanceof NavigationThrow) return error.destination === 'not-found';
    throw error;
  }
}

afterEach(() => vi.unstubAllEnvs());

describe('the sample digests of the end-to-end tests (#430)', () => {
  it('are shown only when the tests’ build asks for them, on a local site', () => {
    expect(showsSampleDigests({ XOMONI_E2E_DIGESTS: '1' }, 'http://localhost:3000')).toBe(true);
    expect(showsSampleDigests({ XOMONI_E2E_DIGESTS: '1' }, 'http://127.0.0.1:3000')).toBe(true);
    expect(showsSampleDigests({}, 'http://localhost:3000')).toBe(false);
    expect(showsSampleDigests({ XOMONI_E2E_DIGESTS: 'true' }, 'http://localhost:3000')).toBe(false);
    // A stray setting in Vercel can't publish them.
    expect(showsSampleDigests({ XOMONI_E2E_DIGESTS: '1' }, 'https://xomoni.com')).toBe(false);
    expect(showsSampleDigests({ XOMONI_E2E_DIGESTS: '1' }, 'http://localhost.evil.com')).toBe(false);
  });

  it('are digests, made up and in the year 2000, with one draft', () => {
    const samples = readDigests(E2E_DIGEST_FILES, false);
    expect(samples.map((d) => [d.month, d.status])).toEqual([
      ['2000-01', 'published'],
      ['2000-02', 'published'],
      ['2000-03', 'draft'],
    ]);
  });
});

describe('readDigests (#430, ADR-0046)', () => {
  it('reads every file, with the samples only when asked', () => {
    const files = [file('2026-05'), file('2026-01')];
    expect(readDigests(files, false).map((d) => d.month)).toEqual(['2026-05', '2026-01']);
    expect(readDigests(files, true).map((d) => d.month)).toEqual([
      '2026-05',
      '2026-01',
      '2000-01',
      '2000-02',
      '2000-03',
    ]);
  });

  it('fails the build on a file that isn’t a digest, naming it and what is wrong', () => {
    expect(() => readDigests([file('2026-05'), { month: '2026-06' }], false)).toThrow(/Digest file 2 is not a digest/);
    expect(() => readDigests([file('2026-05', { messages: ['<b>ok</b>', ' padded'] })], false)).toThrow(
      /messages\.1: starts or ends with a space/,
    );
  });

  it('fails the build on two files of one month', () => {
    expect(() => readDigests([file('2026-05'), file('2026-05')], false)).toThrow(/Two digest files are for 2026-05/);
  });

  it('reads the repository’s own files, each a digest', () => {
    expect(readDigests(DIGEST_FILES, false)).toHaveLength(DIGEST_FILES.length);
  });
});

describe('the pages’ data', () => {
  it('lists published digests only, newest first; the tests’ build adds the samples', () => {
    vi.stubEnv('XOMONI_E2E_DIGESTS', '');
    expect(digestList().every((d) => d.status === 'published')).toBe(true);
    vi.stubEnv('XOMONI_E2E_DIGESTS', '1');
    const months = digestList().map((d) => d.month);
    expect(months.slice(-2)).toEqual(['2000-02', '2000-01']);
    expect(months).not.toContain('2000-03');
  });

  it('shows a published month, and answers 404 for a draft, an unknown month or an address that isn’t one', () => {
    vi.stubEnv('XOMONI_E2E_DIGESTS', '1');
    expect(digestOr404('2000-01').summary).toMatch(/sample digest/);
    for (const month of ['2000-03', '1999-12', '2000-13', NO_DIGEST, '../2000-01', '2000-01.json', ''])
      expect(
        is404(() => digestOr404(month)),
        month,
      ).toBe(true);
  });

  it('builds every published month ahead, or one address that answers 404 when there is none', () => {
    vi.stubEnv('XOMONI_E2E_DIGESTS', '1');
    expect(digestMonths().slice(-2)).toEqual(['2000-02', '2000-01']);
    vi.stubEnv('XOMONI_E2E_DIGESTS', '');
    const months = digestMonths();
    expect(months.length).toBeGreaterThan(0);
    if (digestList().length === 0) {
      expect(months).toEqual([NO_DIGEST]);
      expect(is404(() => digestOr404(NO_DIGEST))).toBe(true);
    }
  });
});
