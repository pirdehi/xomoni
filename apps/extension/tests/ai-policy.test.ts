import { describe, expect, it } from 'vitest';
import {
  AI_POLICY_WINDOWS,
  type PolicyWindow,
  isPolicyDay,
  policyWindowProblems,
  windowsOn,
} from '../src/shared/ai-policy';

// X's AI policy windows (#518, P6.1.3): data with a source and a confidence each, checked so a window without an
// https source, an inverted span or an overlap of one scope breaks the build.

const window = (over: Partial<PolicyWindow> = {}): PolicyWindow => ({
  id: 'w',
  scope: 'x',
  label: 'A window',
  from: '2024-01-01',
  to: null,
  appliesTo: 'public-posts',
  optOut: false,
  sources: [{ url: 'https://example.com/policy', title: 'A policy', accessed: '2026-11-28' }],
  confidence: 'confirmed',
  ...over,
});

describe('X’s AI policy windows', () => {
  it('have no problem: each sourced over https, with real days, and no overlap within a scope', () => {
    expect(policyWindowProblems(AI_POLICY_WINDOWS)).toEqual([]);
    expect(AI_POLICY_WINDOWS.length).toBeGreaterThanOrEqual(2);
    for (const w of AI_POLICY_WINDOWS) {
      expect(w.sources.length).toBeGreaterThan(0);
      for (const s of w.sources) expect(s.url.startsWith('https://')).toBe(true);
    }
  });

  it('hold the plan’s two windows: third parties on public posts, and Grok prompts as content', () => {
    expect(AI_POLICY_WINDOWS.find((w) => w.scope === 'third-party')).toMatchObject({
      from: '2024-11-15',
      appliesTo: 'public-posts',
      optOut: true,
      confidence: 'confirmed',
    });
    expect(AI_POLICY_WINDOWS.find((w) => w.appliesTo === 'grok-prompts')).toMatchObject({
      from: '2026-01-15',
      confidence: 'confirmed',
    });
  });

  it('never say a post was used or trained on', () => {
    for (const w of AI_POLICY_WINDOWS) expect(w.label).not.toMatch(/\bused\b|trained on/i);
  });

  it('are in force on the days they cover', () => {
    expect(windowsOn('2023-09-28').map((w) => w.id)).toEqual([]);
    expect(windowsOn('2024-11-15').map((w) => w.id)).toEqual(['x-models-public', 'third-party-public']);
    expect(windowsOn('2026-01-15')).toHaveLength(3);
    expect(windowsOn('2025-06-01', [window({ to: '2025-05-31' })])).toEqual([]);
    expect(windowsOn('2025-05-31', [window({ to: '2025-05-31' })])).toHaveLength(1);
  });

  it('name each problem: no source, a source over http, no title or day, bad days, an inverted span, an id twice', () => {
    expect(
      policyWindowProblems([
        window({ id: 'a', sources: [] }),
        window({ id: 'b', scope: 'third-party', sources: [{ url: 'http://example.com', title: ' ', accessed: 'x' }] }),
        window({ id: 'c', appliesTo: 'grok-prompts', from: '2024-02-30', to: '2024-13-01' }),
        window({ id: 'd', scope: 'third-party', appliesTo: 'grok-prompts', from: '2025-02-01', to: '2025-01-01' }),
      ]),
    ).toEqual([
      'a: it has no source',
      'b: a source is not https',
      'b: a source has no title',
      'b: a source has no day it was read',
      'c: from is not a day',
      'c: to is not a day',
      'd: it ends before it starts',
    ]);
    expect(policyWindowProblems([window(), window()])).toContain('w: the id is used twice');
  });

  it('refuse two windows of one scope and target that overlap, and allow them side by side', () => {
    const early = window({ id: 'early', from: '2024-01-01', to: '2024-06-30' });
    expect(policyWindowProblems([early, window({ id: 'late', from: '2024-06-30' })])).toEqual([
      'early and late overlap',
    ]);
    expect(policyWindowProblems([early, window({ id: 'late', from: '2024-07-01' })])).toEqual([]);
    expect(policyWindowProblems([early, window({ id: 'other', scope: 'third-party', from: '2024-03-01' })])).toEqual(
      [],
    );
  });

  it('know a real day', () => {
    expect(isPolicyDay('2024-02-29')).toBe(true);
    for (const day of ['2023-02-29', '2024-1-01', '2024-01-01T00:00', '']) expect(isPolicyDay(day)).toBe(false);
  });
});
