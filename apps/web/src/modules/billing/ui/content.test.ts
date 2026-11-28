import { FEATURES, type Feature } from '@xomoni/entitlements';
import { describe, expect, it } from 'vitest';
import * as content from './content';

const lines = () =>
  [
    ...Object.values(content.FEATURE_LABELS),
    ...content.ALWAYS_FREE_LABELS,
    content.PRIVACY_LINE,
    content.PRICE_LINE,
    content.PREVIEW_LINE,
    content.UNAVAILABLE_LINE,
    content.MANAGED_BY_POLAR,
    content.CONFIRMING_LINE,
    content.PAST_DUE_LINE,
  ].join('\n');

describe('the words of the pages for paid plans (#422)', () => {
  it('names every paid feature, and no other', () => {
    expect(Object.keys(content.FEATURE_LABELS).sort()).toEqual((Object.keys(FEATURES) as Feature[]).sort());
  });

  it('keeps safety and data free on every plan', () => {
    expect(content.ALWAYS_FREE_LABELS).toContain('Every safety limit Xomoni keeps on X');
    expect(content.ALWAYS_FREE_LABELS).toContain('Exporting, deleting or moving your data');
  });

  it('writes no price, and promises nothing about X', () => {
    expect(lines()).not.toMatch(/[$€£]\s?\d|\d+\s?(USD|EUR)/);
    expect(lines()).not.toMatch(
      /\b(we|xomoni|a plan|your plan|it) (will|can|does) (restore|recover|unlock|unban|boost|grow|increase|get)\b|guarantee/i,
    );
  });

  it('writes a date in words, by the UTC day', () => {
    expect(content.formatDate(new Date('2026-12-24T23:30:00Z'))).toBe('December 24, 2026');
    expect(content.TIER_NAMES).toEqual({ free: 'Free', plus: 'Plus', pro: 'Pro' });
    expect(content.PREVIEW_BADGE).toBe('Plus · preview');
  });
});
