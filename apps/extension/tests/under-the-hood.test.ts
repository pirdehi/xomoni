import { describe, expect, it } from 'vitest';
import aug from '../../web/e2e/fixtures/under-the-hood/aug-2026.json?raw';
import empty from '../../web/e2e/fixtures/under-the-hood/empty-month.json?raw';
import ineligible from '../../web/e2e/fixtures/under-the-hood/ineligible.json?raw';
import sepWeb from '../../web/e2e/fixtures/under-the-hood/sep-2026-web.json?raw';
import unknownFields from '../../web/e2e/fixtures/under-the-hood/unknown-fields.json?raw';
import {
  LABEL_NAME_MAX,
  LABEL_TEXT_MAX,
  UNDER_THE_HOOD_MAX_BYTES,
  UNDER_THE_HOOD_PROBLEMS,
  type LabelMonth,
  detectUnderTheHood,
  expectedUnderTheHoodMonth,
  labelChanges,
  labelEventWords,
  monthName,
  parseUnderTheHood,
  parseUnderTheHoodText,
  previousMonth,
  utcMonth,
} from '../src/shared/vault/under-the-hood';

const NOW = Date.UTC(2026, 10, 24, 12);

/** The month read from `text`, or a failure naming the problem. */
function month(text: string, now = NOW) {
  const result = parseUnderTheHoodText(text, now);
  if (!result.ok) throw new Error(`refused: ${result.problem}`);
  return result;
}

/** The problem `value` is refused with. */
function problem(value: unknown, now = NOW) {
  const result = typeof value === 'string' ? parseUnderTheHoodText(value, now) : parseUnderTheHood(value, now);
  return result.ok ? null : result.problem;
}

/** X's file, as the July 2026 example has it, with `over` changed. */
function report(over: Record<string, unknown> = {}) {
  return {
    notes: 'Synthetic.',
    period: { startDate: '2026-07-01', endDate: '2026-07-31', timezone: 'UTC' },
    generatedAt: '2026-08-08T23:59:59Z',
    postCount: '383',
    postLabels: [{ label: 'SPAM_HIGH_RECALL', about: 'a', effect: 'b', posts: 2, totalPostsInMonth: 383 }],
    accountLabels: [],
    totalAccountLabels: 0,
    ...over,
  };
}

describe('X’s Under the hood file (#428, ADR-0045)', () => {
  describe('the five synthetic files', () => {
    it('reads August 2026, in the shape of X’s download: labels, X’s own words, the posts and the date', () => {
      const read = month(aug);
      expect(read.month).toEqual<LabelMonth>({
        month: '2026-08',
        labels: [
          {
            name: 'SPAM_HIGH_RECALL',
            count: 3,
            scope: 'posts',
            about: 'Post detected by automated systems as one that may contain spam.',
            effect: 'Post hidden from recommendations to non-followers.',
          },
          {
            name: 'SYNTHETIC_UNKNOWN_LABEL',
            count: 1,
            scope: 'posts',
            about: 'A label made up for the tests.',
            effect: "None: it isn't real.",
          },
        ],
        postsInMonth: 212,
        generatedAt: Date.parse('2026-09-08T23:59:59Z'),
      });
      expect(read.owner).toBeNull();
      expect(read.unknownFields).toEqual([]);
      expect(read.skipped).toBe(0);
    });

    it('reads September 2026 from a web view’s shape: wrapped, snake_case, an account label and an order', () => {
      const read = month(sepWeb);
      expect(read.month.month).toBe('2026-09');
      expect(read.month.postsInMonth).toBe(198);
      expect(read.month.labels.map((l) => [l.name, l.count, l.scope])).toEqual([
        ['SPAM_HIGH_RECALL', 5, 'posts'],
        ['SYNTHETIC_UNKNOWN_LABEL', 2, 'posts'],
        // An account label without a count counts once.
        ['SYNTHETIC_ACCOUNT_LABEL', 1, 'account'],
      ]);
      expect(read.month.labels[0]?.about).toBe('Post detected by automated systems as one that may contain spam.');
      expect(read.month.governmentOrders).toEqual([{ country: 'Synthetic country', count: 1 }]);
      expect(read.month.generatedAt).toBe(Date.parse('2026-10-07T12:00:00Z'));
      expect(read.unknownFields).toEqual([]);
    });

    it('reads a month without labels as no labels, with its posts, never as anything else', () => {
      const read = month(empty);
      expect(read.month).toEqual({
        month: '2026-10',
        labels: [],
        postsInMonth: 40,
        generatedAt: Date.parse('2026-11-08T23:59:59Z'),
      });
    });

    it('reads a month the account wasn’t eligible for as such', () => {
      const read = month(ineligible);
      expect(read.month).toMatchObject({ month: '2026-07', labels: [], eligible: false, postsInMonth: 6 });
    });

    it('names the fields it doesn’t know, keeps none of their values, and skips an entry without a name', () => {
      const read = month(unknownFields);
      expect(read.unknownFields.sort()).toEqual(
        [
          'period.granularity',
          'postLabels[].appealUrl',
          'postLabels[].severity',
          'reachSummary',
          'schemaVersion',
        ].sort(),
      );
      expect(read.skipped).toBe(1);
      expect(read.month.labels).toHaveLength(1);
      expect(JSON.stringify(read.month)).not.toContain('never');
      expect(JSON.stringify(read.month)).not.toContain('example.com');
    });

    it('recognizes every one of them, and nothing else', () => {
      for (const text of [aug, sepWeb, empty, ineligible, unknownFields]) {
        expect(detectUnderTheHood(JSON.parse(text))).toBe(true);
      }
      for (const other of [
        null,
        [],
        'text',
        { name: 'xomoni', version: '1.0.0' },
        { labels: [{ name: 'bug', color: 'red' }] },
        { period: { startDate: '2026-07-01' } },
        { postLabels: [] },
        { data: { report: { items: [] } } },
        { window: { YTD: {} } },
      ]) {
        expect(detectUnderTheHood(other), JSON.stringify(other)).toBe(false);
      }
    });
  });

  describe('refuses, with a reason the person reads', () => {
    it('an unrelated JSON: “This isn’t X’s Under the hood file”', () => {
      const result = parseUnderTheHoodText(JSON.stringify({ name: 'xomoni', dependencies: {} }), NOW);
      expect(result).toEqual({
        ok: false,
        problem: 'not-under-the-hood',
        message: 'This isn’t X’s Under the hood file. Nothing was imported.',
      });
      expect(UNDER_THE_HOOD_PROBLEMS['not-under-the-hood']).toContain('This isn’t X’s Under the hood file');
    });

    it('a file that isn’t JSON, or is cut short', () => {
      expect(problem('window.YTD.tweets.part0 = []')).toBe('not-json');
      expect(problem(aug.slice(0, 200))).toBe('not-json');
      expect(problem('')).toBe('not-json');
      // A byte order mark before the JSON is fine.
      expect(parseUnderTheHoodText(`\uFEFF${aug}`, NOW).ok).toBe(true);
    });

    it('a count below zero, not whole, or not a number', () => {
      for (const posts of [-1, 1.5, 'two', '', null, Number.MAX_SAFE_INTEGER + 2]) {
        const bad = report({ postLabels: [{ label: 'SPAM_HIGH_RECALL', posts }] });
        expect(problem(bad), String(posts)).toBe('bad-count');
      }
      expect(problem(report({ postCount: '-5' }))).toBe('bad-count');
      expect(problem(report({ governmentOrders: [{ country: 'X', count: -1 }] }))).toBe('bad-count');
    });

    it('a month that can’t be right: not a date, before X, or after now', () => {
      for (const startDate of ['July 2026', '2026-13-01', '2026-00-01', '1999-01-01', '2026-12-01', 7, '']) {
        expect(problem(report({ period: { startDate } })), String(startDate)).toBe('bad-month');
      }
      // The month of `now` is fine; X could make a report mid-month.
      expect(problem(report({ period: { startDate: '2026-11-01' } }))).toBeNull();
      // A `month` field instead of a period.
      expect(parseUnderTheHood({ month: '2026-05', postLabels: [] }, NOW)).toMatchObject({
        ok: true,
        month: { month: '2026-05' },
      });
    });

    it('a file larger than 5 MB, before reading it', () => {
      const padding = ' '.repeat(UNDER_THE_HOOD_MAX_BYTES);
      expect(problem(`${aug}${padding}`)).toBe('too-large');
      // Counted in bytes: 2 million two-byte letters are 4 MB, fine; 3 million are 6 MB, too large.
      const notes = (n: number) => JSON.stringify(report({ notes: 'é'.repeat(n) }));
      expect(problem(notes(2_000_000))).toBeNull();
      expect(problem(notes(3_000_000))).toBe('too-large');
    });
  });

  describe('keeps what it reads as text, cut to size (security)', () => {
    it('keeps a label name with markup as text, never decoding or running it', () => {
      const name = '<img src=x onerror=alert(1)>&amp;';
      const read = parseUnderTheHood(
        report({ postLabels: [{ label: name, posts: 1, about: '<script>x</script>' }] }),
        NOW,
      );
      expect(read.ok && read.month.labels[0]).toMatchObject({ name, about: '<script>x</script>' });
    });

    it('removes control characters, trims, and cuts names and X’s words to their maximum', () => {
      const read = parseUnderTheHood(
        report({
          postLabels: [
            { label: ` \u0000SPAM\u001b_HIGH‮${'X'.repeat(200)}`, posts: 1, about: 'y'.repeat(2_000) },
            { label: '\u0000\u0007 ', posts: 1 },
          ],
        }),
        NOW,
      );
      if (!read.ok) throw new Error('refused');
      const [label] = read.month.labels;
      expect(label?.name.startsWith('SPAM_HIGH')).toBe(true);
      expect(label?.name).toHaveLength(LABEL_NAME_MAX);
      expect(label?.about).toHaveLength(LABEL_TEXT_MAX);
      expect(read.skipped).toBe(1);
    });

    it('reads the owner only when the file names an X id or a handle', () => {
      const read = parseUnderTheHood(report({ accountId: '1000', screenName: '@ada_l' }), NOW);
      expect(read.ok && read.owner).toEqual({ accountId: '1000', handle: 'ada_l' });
      const odd = parseUnderTheHood(report({ userId: '../etc', username: 'not a handle!' }), NOW);
      expect(odd.ok && odd.owner).toBeNull();
      const numeric = parseUnderTheHood(report({ user_id: 42 }), NOW);
      expect(numeric.ok && numeric.owner).toEqual({ accountId: '42' });
    });

    it('names at most 50 unknown fields', () => {
      const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`field${i}`, i]));
      const read = parseUnderTheHood(report(many), NOW);
      expect(read.ok && read.unknownFields).toHaveLength(50);
    });
  });

  describe('labels', () => {
    it('adds up a label X lists twice, and keeps a post label and an account label of one name apart', () => {
      const read = parseUnderTheHood(
        report({
          postLabels: [
            { label: 'A', posts: 2 },
            { label: 'A', posts: '3' },
            { label: 'B', posts: 9 },
          ],
          accountLabels: [{ label: 'A' }, 'not an entry'],
        }),
        NOW,
      );
      if (!read.ok) throw new Error('refused');
      expect(read.month.labels.map((l) => [l.name, l.count, l.scope])).toEqual([
        ['B', 9, 'posts'],
        ['A', 5, 'posts'],
        ['A', 1, 'account'],
      ]);
      expect(read.skipped).toBe(1);
    });

    it('takes a plain `labels` list’s scope from each entry, and skips a post label without a count', () => {
      const read = parseUnderTheHood(
        {
          period: { startDate: '2026-07-01' },
          labels: [
            { name: 'P', scope: 'POST', count: 1 },
            { name: 'U', level: 'user' },
            { name: 'Q', count: 4 },
            { name: 'R', scope: 'tweet' },
          ],
        },
        NOW,
      );
      if (!read.ok) throw new Error('refused');
      expect(read.month.labels.map((l) => [l.name, l.count, l.scope])).toEqual([
        ['Q', 4, 'unknown'],
        ['P', 1, 'posts'],
        ['U', 1, 'account'],
      ]);
      expect(read.skipped).toBe(1);
    });

    it('takes the month’s posts from a label when the file has no post count', () => {
      const read = parseUnderTheHood(report({ postCount: undefined }), NOW);
      expect(read.ok && read.month.postsInMonth).toBe(383);
      const none = parseUnderTheHood(report({ postCount: undefined, postLabels: [{ label: 'A', posts: 1 }] }), NOW);
      expect(none.ok && none.month).not.toHaveProperty('postsInMonth');
    });

    it('reads eligibility from a flag, and leaves it out when the file doesn’t say', () => {
      expect(parseUnderTheHood(report({ eligible: true }), NOW)).toMatchObject({ month: { eligible: true } });
      expect(parseUnderTheHood(report({ is_eligible: false }), NOW)).toMatchObject({ month: { eligible: false } });
      expect(parseUnderTheHood(report({ status: 'ineligible' }), NOW)).toMatchObject({ month: { eligible: false } });
      const silent = parseUnderTheHood(report({ status: 'READY' }), NOW);
      expect(silent.ok && silent.month).not.toHaveProperty('eligible');
    });

    it('leaves out a date X wrote wrong rather than refusing the file', () => {
      const read = parseUnderTheHood(report({ generatedAt: 'soon' }), NOW);
      expect(read.ok && read.month).not.toHaveProperty('generatedAt');
    });
  });

  describe('a new or larger label, for the account timeline', () => {
    const july: LabelMonth = {
      month: '2026-07',
      labels: [
        { name: 'SPAM_HIGH_RECALL', count: 2, scope: 'posts' },
        { name: 'OLD', count: 4, scope: 'posts' },
      ],
    };
    const august: LabelMonth = {
      month: '2026-08',
      labels: [
        { name: 'SPAM_HIGH_RECALL', count: 3, scope: 'posts' },
        { name: 'OLD', count: 4, scope: 'posts' },
        { name: 'NEW', count: 1, scope: 'posts' },
        { name: 'ACCT', count: 1, scope: 'account' },
        { name: 'Q', count: 2, scope: 'unknown' },
      ],
    };

    it('names a label that is new or went up, never one that stayed or went down', () => {
      expect(labelChanges(july, august)).toEqual([
        { name: 'SPAM_HIGH_RECALL', scope: 'posts', count: 3, before: 2 },
        { name: 'NEW', scope: 'posts', count: 1, before: 0 },
        { name: 'ACCT', scope: 'account', count: 1, before: 0 },
        { name: 'Q', scope: 'unknown', count: 2, before: 0 },
      ]);
      expect(labelChanges(august, july)).toEqual([]);
      expect(labelChanges(undefined, july)).toHaveLength(2);
      expect(labelChanges(july, { month: '2026-08', labels: [{ name: 'Z', count: 0, scope: 'posts' }] })).toEqual([]);
    });

    it('words each change in Xomoni’s words, with X’s label name', () => {
      const words = labelChanges(july, august).map((c) => labelEventWords(c, august.month));
      expect(words).toEqual([
        'X applied SPAM_HIGH_RECALL to 3 posts in August 2026',
        'X applied NEW to 1 post in August 2026',
        'X applied ACCT to the account in August 2026',
        'X listed Q (2) in August 2026',
      ]);
    });
  });

  describe('months', () => {
    it('names a month, and leaves anything else as it is', () => {
      expect(monthName('2026-07')).toBe('July 2026');
      expect(monthName('2026-12')).toBe('December 2026');
      expect(monthName('2026-13')).toBe('2026-13');
      expect(monthName('soon')).toBe('soon');
    });

    it('steps back a month, across a year', () => {
      expect(previousMonth('2026-07')).toBe('2026-06');
      expect(previousMonth('2026-01')).toBe('2025-12');
      expect(utcMonth(Date.UTC(2026, 0, 31, 23, 59))).toBe('2026-01');
    });

    it('expects last month’s report from the 3rd, and the one before until then', () => {
      expect(expectedUnderTheHoodMonth(Date.UTC(2026, 7, 3))).toBe('2026-07');
      expect(expectedUnderTheHoodMonth(Date.UTC(2026, 7, 2, 23, 59))).toBe('2026-06');
      expect(expectedUnderTheHoodMonth(Date.UTC(2026, 0, 2))).toBe('2025-11');
      expect(expectedUnderTheHoodMonth(Date.UTC(2026, 0, 3))).toBe('2025-12');
    });
  });
});
