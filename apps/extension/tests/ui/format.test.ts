// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JOB_STATE,
  KIND_PLURAL,
  OUTCOME_LABEL,
  TARGET_PLURAL,
  downloadFile,
  errorMessage,
  fmtAgo,
  fmtCompact,
  fmtDate,
  fmtDateTime,
  fmtDuration,
  fmtNumber,
  fromDateInput,
  postUrl,
  toDateInput,
} from '../../src/ui/format';
import { captureDownloads } from '../support/shell';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('number formats', () => {
  it('shows exact counts below 10,000 and compact ones from there', () => {
    expect(fmtCompact(0)).toBe('0');
    expect(fmtCompact(9_999)).toBe('9,999');
    expect(fmtCompact(10_000)).toBe('10K');
    expect(fmtCompact(12_345)).toBe('12.3K');
    expect(fmtCompact(2_500_000)).toBe('2.5M');
  });

  it('separates thousands', () => {
    expect(fmtNumber(1_234_567)).toBe('1,234,567');
    expect(fmtNumber(12)).toBe('12');
  });
});

describe('dates', () => {
  it('formats a date in local time, and a dash for no date', () => {
    expect(fmtDate(new Date(2021, 2, 5, 23, 59).getTime())).toBe('Mar 5, 2021');
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtDate(0)).toBe('—');
  });

  it('formats month, day and time without the year', () => {
    const text = fmtDateTime(new Date(2021, 2, 5, 14, 7).getTime());
    expect(text).toMatch(/^Mar 5, 02:07\sPM$/u);
    expect(text).not.toContain('2021');
    expect(fmtDateTime(null)).toBe('—');
    expect(fmtDateTime(0)).toBe('—');
  });

  it('round-trips date inputs through local midnight', () => {
    const ms = new Date(2020, 0, 9, 18, 30).getTime();
    expect(toDateInput(ms)).toBe('2020-01-09');
    expect(fromDateInput('2020-01-09')).toBe(new Date(2020, 0, 9).getTime());
    expect(fromDateInput(toDateInput(ms))).toBe(new Date(2020, 0, 9).getTime());
  });

  it('reads an empty or incomplete date input as no date', () => {
    expect(fromDateInput('')).toBeNull();
    expect(fromDateInput('2020-01')).toBeNull();
    expect(fromDateInput('2020')).toBeNull();
    expect(fromDateInput('abc')).toBeNull();
  });
});

describe('durations', () => {
  it('uses the two largest units', () => {
    expect(fmtDuration(2 * DAY + 3 * HOUR + 59 * MINUTE)).toBe('2d 3h');
    expect(fmtDuration(4 * HOUR + 12 * MINUTE)).toBe('4h 12m');
    expect(fmtDuration(5 * MINUTE + 12 * SECOND)).toBe('5m 12s');
    expect(fmtDuration(42 * SECOND)).toBe('42s');
    expect(fmtDuration(1 * DAY)).toBe('1d 0h');
  });

  it('rounds to whole seconds and says 0s for no time left', () => {
    expect(fmtDuration(1_499)).toBe('1s');
    expect(fmtDuration(0)).toBe('0s');
    expect(fmtDuration(-5_000)).toBe('0s');
  });
});

describe('relative time', () => {
  const now = new Date(2024, 5, 15, 12, 0).getTime();

  it('counts minutes and hours back, then shows the date', () => {
    expect(fmtAgo(now - 59 * SECOND, now)).toBe('just now');
    expect(fmtAgo(now - 5 * MINUTE, now)).toBe('5m ago');
    expect(fmtAgo(now - 3 * HOUR - 59 * MINUTE, now)).toBe('3h ago');
    expect(fmtAgo(now - 25 * HOUR, now)).toBe(fmtDate(now - 25 * HOUR));
  });

  it('says just now for a time in the future', () => {
    expect(fmtAgo(now + HOUR, now)).toBe('just now');
  });

  it('uses the current time by default', () => {
    expect(fmtAgo(Date.now() - 2 * MINUTE)).toBe('2m ago');
  });
});

describe('labels and links', () => {
  it('has a label for every kind, target, job state and outcome', () => {
    expect(KIND_PLURAL.repost).toBe('Reposts');
    expect(TARGET_PLURAL.reply).toBe('replies');
    expect(JOB_STATE.waiting).toEqual({ label: 'Needs you', tone: 'serious' });
    expect(JOB_STATE.blocked.label).toBe('Stopped for safety');
    expect(OUTCOME_LABEL.automation_flag).toBe('Flagged (226)');
  });

  it('links to a post with or without its author', () => {
    expect(postUrl('123', 'me')).toBe('https://x.com/me/status/123');
    expect(postUrl('123')).toBe('https://x.com/i/web/status/123');
    expect(postUrl('123', '')).toBe('https://x.com/i/web/status/123');
  });

  it('turns any thrown value into text', () => {
    expect(errorMessage(new Error('Boom'))).toBe('Boom');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
  });
});

describe('downloadFile', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('saves the content under the name and type given, JSON by default', async () => {
    const downloads = captureDownloads();
    downloadFile('data.json', '{"a":1}');
    downloadFile('log.csv', 'a,b', 'text/csv');

    expect(downloads.map((d) => [d.name, d.type])).toEqual([
      ['data.json', 'application/json'],
      ['log.csv', 'text/csv'],
    ]);
    expect(await downloads[0]!.text()).toBe('{"a":1}');
    expect(await downloads[1]!.text()).toBe('a,b');
  });

  it('releases the object URL a second later', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    captureDownloads();
    downloadFile('data.json', '{}');

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
  });
});
