import { describe, expect, it } from 'vitest';
import { formatDate, formatNumber, formatWhen, plural, utcDay } from './format';

describe('console formats', () => {
  it('writes moments in UTC, and a dash or the given word for none', () => {
    expect(formatWhen('2026-11-28T10:05:00Z')).toBe('28 Nov 2026, 10:05 UTC');
    expect(formatWhen(null)).toBe('—');
    expect(formatWhen('not a date', 'Never')).toBe('Never');
    expect(formatDate('2026-11-28T23:30:00Z')).toBe('28 Nov 2026');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('nope')).toBe('—');
  });

  it('writes counts with separators and nouns in the right number', () => {
    expect(formatNumber(12480.4)).toBe('12,480');
    expect(plural(1, 'session')).toBe('1 session');
    expect(plural(0, 'session')).toBe('0 sessions');
    expect(plural(2, 'person', 'people')).toBe('2 people');
  });

  it('gives today in UTC', () => {
    expect(utcDay(Date.parse('2026-11-28T23:59:59Z'))).toBe('2026-11-28');
  });
});
