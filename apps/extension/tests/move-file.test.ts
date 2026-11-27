import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_MOVE_BYTES,
  MOVE_FORMAT,
  MOVE_LIMITS,
  MOVE_PROBLEMS,
  MOVE_TABLES,
  MOVE_VERSION,
  type MoveData,
  type MoveHeader,
  checkMoveFile,
  checkMoveText,
  moveChecksum,
  moveRecord,
  movedValueName,
  summarizeMove,
  writeMoveFile,
} from '../src/shared/move-file';
import {
  MOVER,
  NOW,
  THEN,
  moverAccount,
  moverDay,
  moverItem,
  moverJob,
  moverLog,
  moverReply,
  signedFile,
} from './support/move';

/** A small but complete move file's data: one record in most tables. */
function data(over: Partial<MoveData> = {}): MoveData {
  return {
    accounts: [moverAccount()],
    items: [moverItem('1000000001'), moverItem('1000000002', { kind: 'like', author: '', sources: ['archive'] })],
    jobs: [moverJob('job-1')],
    logs: [moverLog()],
    limits: [],
    reads: [{ accountId: MOVER, budget: 'search', ts: THEN }],
    risk: [{ accountId: MOVER, kind: 'rate_limited', at: THEN }],
    checks: [],
    daily: [moverDay()],
    incoming: [moverReply('3000000001')],
    kv: [{ key: 'activeAccount', value: MOVER }],
    ...over,
  };
}

/** A file whose `table` holds `record` and nothing else, with a checksum that matches. */
const withRecord = (table: keyof MoveData, record: unknown) => signedFile({ ...data(), [table]: [record] });

async function refused(text: string) {
  const result = await checkMoveText(text, NOW);
  if (result.ok) throw new Error('The file was accepted');
  return result;
}

describe('the move file (#300, ADR-0032)', () => {
  it('reads back what the export writes, every table checked, with what it holds per account', async () => {
    const text = await writeMoveFile('0.5.0', data(), THEN);
    const result = await checkMoveText(text, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['format', 'version', 'app', 'exportedAt', 'checksum', 'data']);
    expect(parsed).toMatchObject({ format: MOVE_FORMAT, version: MOVE_VERSION, app: '0.5.0' });
    expect(parsed.exportedAt).toBe(new Date(THEN).toISOString());
    expect(parsed.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.keys(parsed.data as object)).toEqual([...MOVE_TABLES]);
    expect(result.file.data).toEqual(data());
    expect(result.summary).toEqual({
      app: '0.5.0',
      exportedAt: THEN,
      accounts: [{ id: MOVER, handle: 'mover', posts: 1, likes: 1, jobs: 1, logs: 1 }],
      counts: { ...Object.fromEntries(MOVE_TABLES.map((t) => [t, 1])), items: 2, limits: 0, checks: 0 },
    });
  });

  it('checksums the header and the data together, so changing either is noticed', async () => {
    const header: MoveHeader = {
      format: MOVE_FORMAT,
      version: MOVE_VERSION,
      app: '0.5.0',
      exportedAt: '2026-11-20T12:00:00.000Z',
    };
    const sum = await moveChecksum(header, data());
    expect(await moveChecksum({ ...header, app: '0.5.1' }, data())).not.toBe(sum);
    expect(await moveChecksum(header, data({ kv: [] }))).not.toBe(sum);
    expect(await moveChecksum(header, data())).toBe(sum);
  });

  describe('refuses a file that was changed after it was exported', () => {
    it('when a record was edited and the checksum left as it was', async () => {
      const text = await writeMoveFile('0.5.0', data(), THEN);
      const tampered = text.replace('"post 1000000001"', '"edited"');
      expect(tampered).not.toBe(text);

      const result = await refused(tampered);
      expect(result.problem).toBe('changed');
      expect(result.message).toBe(MOVE_PROBLEMS.changed);
      expect(result.message).toContain('Nothing was imported');
    });

    it('when a record was added, or the header changed', async () => {
      const parsed = JSON.parse(await writeMoveFile('0.5.0', data(), THEN)) as { data: MoveData; app: string };
      parsed.data.risk = [];
      expect((await refused(JSON.stringify(parsed))).problem).toBe('changed');

      const other = JSON.parse(await writeMoveFile('0.5.0', data(), THEN)) as { app: string };
      other.app = '9.9.9';
      expect((await refused(JSON.stringify(other))).problem).toBe('changed');
    });

    it('when the checksum is missing or not a SHA-256', async () => {
      const parsed = JSON.parse(await writeMoveFile('0.5.0', data(), THEN)) as Record<string, unknown>;
      expect((await refused(JSON.stringify({ ...parsed, checksum: 'md5:abc' }))).problem).toBe('broken');
      const { checksum: _gone, ...without } = parsed;
      expect((await refused(JSON.stringify(without))).problem).toBe('broken');
    });
  });

  describe('refuses records out of shape, even with a matching checksum', () => {
    const cases: [string, keyof MoveData, unknown][] = [
      ['an account id that is not an X id', 'accounts', moverAccount({ id: '../etc' })],
      ['an avatar from anywhere but X', 'accounts', moverAccount({ avatar: 'https://evil.example/a.png' })],
      ['an item whose key names another account', 'items', { ...moverItem('1000000001'), key: '2:post:1000000001' }],
      ['an item of a kind Xomoni doesn’t know', 'items', moverItem('1000000001', { kind: 'dm' as never })],
      ['a post id that is not an X id', 'items', { ...moverItem('1'), id: 'javascript:alert(1)' }],
      ['an author that could leave x.com', 'items', moverItem('1000000001', { author: 'evil.com/x' })],
      ['a post text longer than any post', 'items', moverItem('1000000001', { text: 'x'.repeat(100_001) })],
      ['a time far in the future', 'items', moverItem('1000000001', { statusAt: NOW + 3 * 86_400_000 })],
      ['a count that is not a whole number', 'items', moverItem('1000000001', { likes: -1 })],
      ['a reply-to on a post', 'items', moverItem('1000000001', { replyTo: 'friend' })],
      ['a negative number of links (#428)', 'items', moverItem('1000000001', { links: -1 })],
      ['more media than any post carries (#428)', 'items', moverItem('1000000001', { media: 101 })],
      ['links that aren’t a whole number (#428)', 'items', moverItem('1000000001', { links: 1.5 })],
      ['media as text (#428)', 'items', moverItem('1000000001', { media: '2' as never })],
      [
        'links on a like, which only a post or a reply carries (#497)',
        'items',
        moverItem('1000000001', { kind: 'like', links: 1 }),
      ],
      [
        'media on a repost, which only a post or a reply carries (#497)',
        'items',
        moverItem('1000000001', { kind: 'repost', media: 0 }),
      ],
      ['a job state Xomoni doesn’t know', 'jobs', moverJob('j', { state: 'hacked' as never })],
      ['a job id with markup', 'jobs', moverJob('<script>')],
      [
        'a cleanup rule with ids that aren’t X ids',
        'jobs',
        moverJob('j', { filter: { ...moverJob('j').filter!, keepIds: ['x'] } }),
      ],
      ['a log line with an unknown action', 'logs', moverLog({ action: 'post' as never })],
      ['a log line pointing at a non-post', 'logs', moverLog({ targetId: 'https://evil.example' })],
      [
        'a limit for an operation Xomoni doesn’t watch',
        'limits',
        {
          key: `${MOVER}:CreateTweet`,
          accountId: MOVER,
          op: 'CreateTweet',
          limit: 1,
          remaining: 1,
          reset: null,
          status: 200,
          at: THEN,
        },
      ],
      ['a page load of an unknown budget', 'reads', { accountId: MOVER, budget: 'everything', ts: THEN }],
      ['a risk event of an unknown kind', 'risk', { accountId: MOVER, kind: 'all_clear', at: THEN }],
      [
        'a check of a post id that isn’t one',
        'checks',
        { accountId: MOVER, jobId: 'j', action: 'delete', postId: '../x', at: THEN, dueAt: THEN },
      ],
      ['a day that is not a date', 'daily', moverDay({ day: 'yesterday' })],
      ['a reply without an author', 'incoming', { ...moverReply('3000000001'), author: '' }],
      ['settings in the wrong shape', 'kv', { key: 'settings', value: { pacing: { delete: { minDelay: 'fast' } } } }],
      ['an active account that is not an X id', 'kv', { key: 'activeAccount', value: 'me' }],
      ['a view cap without a number', 'kv', { key: `viewCap:${MOVER}`, value: { cap: 'none' } }],
      ['a record that is not an object', 'items', 'post'],
    ];
    it.each(cases)('%s', async (_, table, record) => {
      const result = await refused(await withRecord(table, record));
      expect(result.problem).toBe('bad-record');
      expect(result.where).toBe(`${table}, record 1`);
      expect(result.message).toBe(MOVE_PROBLEMS['bad-record']);
    });
  });

  it('refuses two records with one key, which no table holds', async () => {
    const twice = await signedFile({ ...data(), items: [moverItem('1000000001'), moverItem('1000000001')] });
    expect(await refused(twice)).toMatchObject({ problem: 'bad-record', where: 'items, record 2' });
    const days = await signedFile({ ...data(), daily: [moverDay(), moverDay({ receivedLikes: 9 })] });
    expect(await refused(days)).toMatchObject({ problem: 'bad-record', where: 'daily, record 2' });
    // Rows without a key of their own may repeat: two log lines can say the same at the same moment.
    expect((await checkMoveText(await signedFile({ ...data(), logs: [moverLog(), moverLog()] }), NOW)).ok).toBe(true);
  });

  it('refuses records for a table Xomoni doesn’t know', async () => {
    const result = await refused(await signedFile({ ...data(), passwords: [{ x: 'secret' }] }));
    expect(result.problem).toBe('unknown-table');
    expect(result.where).toBe('passwords');
  });

  it('refuses values Xomoni never moves, such as the xomoni.com token or the consent', async () => {
    for (const key of ['cloud', 'signedOut', 'websitePlan', `downloadsFolder`, `watchTabs:not-an-id`, 'moveOffer']) {
      const result = await refused(await withRecord('kv', { key, value: { token: 'secret' } }));
      expect(result.problem).toBe('unknown-table');
    }
    expect((await refused(await signedFile({ ...data(), consents: [] }))).problem).toBe('unknown-table');
  });

  it('refuses a file missing a table, or with a table that is not a list', async () => {
    const { incoming: _left, ...missing } = data();
    expect(await refused(await signedFile(missing))).toMatchObject({ problem: 'broken', where: 'incoming' });
    expect((await refused(await signedFile({ ...data(), items: {} }))).problem).toBe('broken');
    expect((await refused(await signedFile(['not', 'tables']))).problem).toBe('broken');
  });

  it('refuses a file from a newer Xomoni, and any other version, with its own message', async () => {
    const newer = await refused(await signedFile(data(), { version: MOVE_VERSION + 1 }));
    expect(newer.problem).toBe('newer');
    expect(newer.message).toContain('Update this Xomoni first');
    for (const version of [0, -1, 1.5, '1', null]) {
      expect((await refused(await signedFile(data(), { version }))).problem).toBe('other-version');
    }
  });

  it('refuses an older Xomoni’s Export everything, which can’t carry a move, and says how to get a full one', async () => {
    const old = JSON.stringify({ exportedAt: '2026-11-01T00:00:00.000Z', accounts: [], items: [], jobs: [], logs: [] });
    const result = await refused(old);
    expect(result.problem).toBe('old-export');
    expect(result.message).toContain('Update the Xomoni you’re leaving');
  });

  it('refuses what isn’t a Xomoni export at all', async () => {
    for (const text of ['', 'not json', '[]', 'null', '{"format":"xomoni-archive","version":1}', '{}']) {
      expect((await refused(text)).problem).toBe('not-xomoni');
    }
  });

  it('refuses a header out of shape: an app version with markup, a date far ahead', async () => {
    expect((await refused(await signedFile(data(), { app: '<b>1</b>' }))).problem).toBe('broken');
    expect((await refused(await signedFile(data(), { exportedAt: 'soon' }))).problem).toBe('broken');
    const later = new Date(NOW + 3 * 86_400_000).toISOString();
    expect((await refused(await signedFile(data(), { exportedAt: later }))).problem).toBe('broken');
  });

  it('refuses a file larger than 256 MB before reading it', async () => {
    const text = vi.fn(() => Promise.resolve('{}'));
    const result = await checkMoveFile({ size: MAX_MOVE_BYTES + 1, text }, NOW);
    expect(result).toMatchObject({ ok: false, problem: 'too-big' });
    expect(text).not.toHaveBeenCalled();
    expect(MAX_MOVE_BYTES).toBe(256 * 1024 * 1024);
  });

  it('refuses a table holding more than Xomoni ever keeps', async () => {
    const check = { accountId: MOVER, jobId: 'j', action: 'delete', postId: '1', at: THEN, dueAt: THEN };
    const checks = Array.from({ length: MOVE_LIMITS.checks + 1 }, () => check);
    expect(await refused(await signedFile({ ...data(), checks }))).toMatchObject({
      problem: 'too-big',
      where: 'checks',
    });
  });

  it('refuses a file with nothing in it', async () => {
    const empty = Object.fromEntries(MOVE_TABLES.map((t) => [t, []]));
    expect((await refused(await signedFile(empty))).problem).toBe('empty');
  });

  it('reads a file from the person’s computer through `checkMoveFile`', async () => {
    const blob = new Blob([await writeMoveFile('0.5.0', data(), THEN)], { type: 'application/json' });
    expect((await checkMoveFile(blob, NOW)).ok).toBe(true);
  });

  describe('each record', () => {
    it('is copied with only the fields Xomoni knows; auto-increment numbers are left to the receiving one', () => {
      const copy = moveRecord('logs', { ...moverLog(), seq: 41, extra: '<img onerror>' }, NOW);
      expect(copy).toEqual(moverLog());
      expect(moveRecord('reads', { seq: 3, accountId: MOVER, budget: 'search', ts: THEN, junk: 1 }, NOW)).toEqual({
        accountId: MOVER,
        budget: 'search',
        ts: THEN,
      });
    });

    it('gets today’s value for a field an older Xomoni didn’t write yet', () => {
      const old = { key: `${MOVER}:post:1000000001`, accountId: MOVER, kind: 'post', id: '1000000001' };
      expect(moveRecord('items', old, NOW)).toEqual({
        ...old,
        targetId: '1000000001',
        createdAt: 0,
        likedAt: null,
        text: '',
        author: '',
        inReplyToId: null,
        selfReply: false,
        likes: 0,
        reposts: 0,
        replies: 0,
        sources: ['scan'],
        status: 'present',
        seenAt: 0,
        statusAt: 0,
        lastJobId: null,
      });
      const job = moveRecord('jobs', { id: 'j1', accountId: MOVER, kind: 'scan', state: 'completed' }, NOW);
      expect(job).toMatchObject({ stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 }, filter: null });
    });

    it('keeps a post’s links and media when they are there, 0 to 100, and leaves them out when not (#428)', () => {
      const counted = moverItem('1000000001', { links: 2, media: 0 });
      expect(moveRecord('items', counted, NOW)).toEqual(counted);
      expect(moveRecord('items', moverItem('1000000001', { links: 100, media: 100 }), NOW)).toMatchObject({
        links: 100,
        media: 100,
      });
      const older = moveRecord('items', moverItem('1000000001'), NOW);
      expect(older).not.toHaveProperty('links');
      expect(older).not.toHaveProperty('media');
      // A reply carries them too; a like or a repost, without them, still moves (#497).
      const reply = moverItem('1000000002', { kind: 'reply', links: 1, media: 2 });
      expect(moveRecord('items', reply, NOW)).toEqual(reply);
      for (const kind of ['like', 'repost'] as const) {
        const other = moverItem('1000000003', { kind });
        expect(moveRecord('items', other, NOW)).toEqual(other);
      }
    });

    it('keeps replies to the person cut to 1,000 characters (ADR-0030)', () => {
      const long = { ...moverReply('3000000001'), text: 'y'.repeat(5_000) };
      expect(moveRecord('incoming', long, NOW)?.text).toHaveLength(1_000);
    });

    it('reads settings an older Xomoni kept as typed text, as `normalizeSettings` does', () => {
      const typed = { maxConsecutiveFailures: '2', activeHours: { enabled: true, start: '8', end: 23 } };
      expect(moveRecord('kv', { key: 'settings', value: typed }, NOW)).toEqual({
        key: 'settings',
        value: { maxConsecutiveFailures: 2, activeHours: { enabled: true, start: 8, end: 23 } },
      });
      expect(
        moveRecord('kv', { key: 'settings', value: { activeHours: { enabled: true, start: 24, end: 1 } } }, NOW),
      ).toBeNull();
      expect(moveRecord('kv', { key: 'settings', value: { pacing: { delete: { minDelay: -1 } } } }, NOW)).toBeNull();
      expect(moveRecord('kv', { key: 'settings', value: { pacing: { system: {} } } }, NOW)).toBeNull();
    });

    it('accepts the archive marker of imports made before it kept a date', () => {
      expect(moveRecord('kv', { key: `archive:${MOVER}`, value: true }, NOW)).toEqual({
        key: `archive:${MOVER}`,
        value: true,
      });
    });
  });

  it('names only the `kv` values a move carries', () => {
    expect(movedValueName('settings')).toBe('settings');
    expect(movedValueName(`watchTabs:${MOVER}`)).toBe('watchTabs');
    expect(movedValueName(`viewCap:${MOVER}`)).toBe('viewCap');
    for (const key of [
      'cloud',
      'signedOut',
      'dailyStats',
      'moveOffer',
      `archiveFilesSeen:${MOVER}`,
      'watchTabs:me',
      'x',
    ])
      expect(movedValueName(key)).toBeNull();
  });

  it('sums what each account holds, leaving out records of accounts not in the file', () => {
    const summary = summarizeMove({
      format: MOVE_FORMAT,
      version: MOVE_VERSION,
      app: '0.5.0',
      exportedAt: new Date(THEN).toISOString(),
      checksum: '',
      data: data({ items: [...data().items, moverItem('1000000005', { accountId: '9' })] }),
    });
    expect(summary.accounts).toEqual([{ id: MOVER, handle: 'mover', posts: 1, likes: 1, jobs: 1, logs: 1 }]);
    expect(summary.counts.items).toBe(3);
  });
});
