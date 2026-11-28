// Sample digests for the end-to-end tests (docs/scenarios/430-algorithm-digest.md): made up, in the year 2000 so no real
// digest shares their months, and shown only by the tests' own build (`XOMONI_E2E_DIGESTS=1` on a local site, see
// `server/digests.ts`). Each is unchecked until `parseDigest` reads it, like a real file.

/** A made-up commit id: `n` repeated, so it is plainly not X's. */
const fake = (n: string) => n.repeat(40);

/**
 * The tests' digests: January 2000, published, with every part filled in; February 2000, published, whose only commit
 * message is markup and which changed no parameter; and March 2000, a draft, which no page may show.
 */
export const E2E_DIGEST_FILES: readonly unknown[] = [
  {
    version: 1,
    month: '2000-01',
    repo: 'xai-org/x-algorithm',
    from: fake('1'),
    to: fake('2'),
    toDate: '2000-01-20',
    status: 'published',
    summary:
      'A sample digest for the end-to-end tests: it says nothing about X’s real code.\n\n' +
      'A second paragraph, to show that a blank line starts a new one (see `home-mixer/params/config.rs`).',
    commits: 12,
    files: 3,
    filesCapped: false,
    areas: [
      { area: 'ranking', files: 1, paths: ['home-mixer/scorers/sample_scorer.rs'] },
      { area: 'filters', files: 1, paths: ['home-mixer/filters/sample_filter.rs'] },
      { area: 'parameters', files: 1, paths: ['home-mixer/params/config.rs'] },
    ],
    parameters: ['rust_home_mixer_sample_weight', 'rust_home_mixer_sample_switch'],
    parameterCount: 52,
    messages: ['Open-source X Recommendation Algorithm'],
  },
  {
    version: 1,
    month: '2000-02',
    repo: 'xai-org/x-algorithm',
    from: fake('2'),
    to: fake('3'),
    toDate: '2000-02-20',
    status: 'published',
    summary: 'A sample digest whose commit message is markup, which the page must show as text.',
    commits: 1,
    files: 1,
    filesCapped: false,
    areas: [{ area: 'docs', files: 1, paths: ['docs/<b>sample</b>.md'] }],
    parameters: [],
    parameterCount: 0,
    messages: ['<script>window.__xomoniDigestRan = true</script><img src=x onerror="window.__xomoniDigestRan = true">'],
  },
  {
    version: 1,
    month: '2000-03',
    repo: 'xai-org/x-algorithm',
    from: fake('3'),
    to: fake('4'),
    toDate: '2000-03-20',
    status: 'draft',
    summary: '',
    commits: 2,
    files: 1,
    filesCapped: false,
    areas: [{ area: 'other', files: 1, paths: ['home-mixer/main.rs'] }],
    parameters: [],
    parameterCount: 0,
    messages: ['A draft no page may show'],
  },
];
