import { describe, expect, it } from 'vitest';
import { countdown, secondsLeft } from './pairing';

const NOW = Date.UTC(2026, 10, 2, 12);
const code = (msFromNow: number) => ({ code: 'AB2CD-EF3GH', expiresAt: new Date(NOW + msFromNow).toISOString() });

describe('pairing codes (ADR-0018)', () => {
  it('counts the whole seconds a code has left, and none once it expired', () => {
    expect(secondsLeft(code(600_000), NOW)).toBe(600);
    expect(secondsLeft(code(1_500), NOW)).toBe(2);
    expect(secondsLeft(code(0), NOW)).toBe(0);
    expect(secondsLeft(code(-5_000), NOW)).toBe(0);
  });

  it('shows the countdown as m:ss', () => {
    expect(countdown(600)).toBe('10:00');
    expect(countdown(65)).toBe('1:05');
    expect(countdown(0)).toBe('0:00');
    expect(countdown(-3)).toBe('0:00');
  });
});
