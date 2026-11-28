import { describe, expect, it } from 'vitest';
import { REFRESH_EVERY_MS, refreshLimiter } from './refresh-limit';

describe('refreshLimiter (#421)', () => {
  it('lets each person refresh once a minute', () => {
    let now = 0;
    const allow = refreshLimiter(REFRESH_EVERY_MS, () => now);
    expect(allow('ada')).toBe(true);
    expect(allow('ada')).toBe(false);
    expect(allow('bob')).toBe(true);
    now = REFRESH_EVERY_MS - 1;
    expect(allow('ada')).toBe(false);
    now = REFRESH_EVERY_MS;
    expect(allow('ada')).toBe(true);
  });

  it('remembers a bounded number of people, forgetting the oldest first', () => {
    const allow = refreshLimiter(60_000, () => 0);
    for (let i = 0; i <= 10_000; i++) allow(`p${i}`);
    expect(allow('p0')).toBe(true);
    expect(allow('p10000')).toBe(false);
  });
});
