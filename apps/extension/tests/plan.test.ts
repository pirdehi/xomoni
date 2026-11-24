import { describe, expect, it, vi } from 'vitest';
import { PLUS_FEATURES, isPlusFeature, planOf } from '../src/shared/plan';

// The Plus plan's parts, named before payments come (#425, CV.2.5): a closed list, and every account on preview.

describe('the plan the dashboard shows', () => {
  it('names R1’s Plus parts, Reach’s, by the ids payments will use (#420)', () => {
    expect(PLUS_FEATURES).toEqual([
      'reach-history',
      'reach-compare',
      'reach-suspects',
      'reach-alerts',
      'reach-website',
    ]);
    for (const feature of PLUS_FEATURES) expect(isPlusFeature(feature)).toBe(true);
  });

  it('never names a way to take one’s data out, delete it, move it, or a safety rail', () => {
    for (const free of [
      'vault-export',
      'export',
      'download-a-copy',
      'delete-local-data',
      'move-file',
      'pacing',
      'vault',
    ])
      expect(isPlusFeature(free)).toBe(false);
  });

  it('is preview for everyone, asking no server', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(planOf()).toBe('preview');
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
