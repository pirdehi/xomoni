import { describe, expect, it } from 'vitest';
import { NavigationThrow } from '@test/fakes/navigation';
import { sectionOr404, sectionSlugs, sectionTitle } from './sections';

describe('sectionOr404 (#245)', () => {
  it('gives the place an address names, and Overview without one', () => {
    expect(sectionOr404().id).toBe('overview');
    expect(sectionOr404('reports').label).toBe('Reports');
  });

  it('answers a 404 for a place that doesn’t exist', () => {
    expect(() => sectionOr404('../account')).toThrow(NavigationThrow);
    try {
      sectionOr404('admin');
    } catch (err) {
      expect((err as NavigationThrow).destination).toBe('not-found');
    }
  });

  it('lists every place but Overview for the route, which lives at /dashboard itself', () => {
    expect(sectionSlugs()).toHaveLength(13);
    expect(sectionSlugs()).not.toContain('overview');
    expect(sectionSlugs()).toContain('browsers');
    expect(sectionSlugs()).toContain('reach');
  });

  it('titles a page by its place, and Dashboard for an unknown address', () => {
    expect(sectionTitle('engagement')).toBe('Engagement');
    expect(sectionTitle('admin')).toBe('Dashboard');
  });
});
