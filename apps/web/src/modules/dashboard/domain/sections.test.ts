import { describe, expect, it } from 'vitest';
import { GROUPS, SECTIONS, sectionFromSlug, sectionHref, xomoniPageFor } from './sections';

describe('the dashboard’s places (#245)', () => {
  it('has every place of the plan once, in four groups, Overview first', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual([
      'overview',
      'audience',
      'content',
      'engagement',
      'reports',
      'library',
      'comments',
      'cleanup',
      'watch',
      'activity',
      'health',
      'browsers',
      'settings',
    ]);
    expect(GROUPS.map((g) => g.id)).toEqual(['overview', 'insights', 'manage', 'history']);
    expect(new Set(SECTIONS.map((s) => s.group))).toEqual(new Set(GROUPS.map((g) => g.id)));
  });

  it('uses the extension’s names for the places the extension has', () => {
    const labels = SECTIONS.map((s) => s.label);
    for (const name of ['Library', 'Cleanup', 'Watch', 'Activity', 'Settings']) expect(labels).toContain(name);
  });

  it('says, for each place not built yet, what it will show and which issue builds it', () => {
    for (const section of SECTIONS.filter((s) => !s.ready)) {
      expect(section.shows.length).toBeGreaterThan(0);
      expect(section.issue).toBeGreaterThan(0);
      expect(section.source).not.toBe('');
    }
    expect(SECTIONS.filter((s) => s.ready).map((s) => s.id)).toEqual([
      'overview',
      'audience',
      'content',
      'engagement',
      'reports',
      'library',
      'comments',
      'cleanup',
      'watch',
      'activity',
      'health',
      'browsers',
      'settings',
    ]);
  });

  it('marks as needing Xomoni exactly the places whose lists or actions come from the extension (ADR-0027)', () => {
    expect(SECTIONS.filter((s) => s.needsXomoni).map((s) => s.id)).toEqual([
      'library',
      'comments',
      'cleanup',
      'watch',
      'health',
      'settings',
    ]);
  });

  it('finds a place by its address, Overview without one, and nothing for an unknown one', () => {
    expect(sectionFromSlug(undefined)?.id).toBe('overview');
    expect(sectionFromSlug('audience')?.label).toBe('Audience');
    expect(sectionFromSlug('admin')).toBeNull();
    expect(sectionFromSlug('')).toBeNull();
  });

  it('builds addresses that keep the account and period', () => {
    expect(sectionHref('overview')).toBe('/dashboard');
    expect(sectionHref('activity')).toBe('/dashboard/activity');
    expect(sectionHref('audience', 'account=ada&period=7d')).toBe('/dashboard/audience?account=ada&period=7d');
  });
});

describe('xomoniPageFor (ADR-0027, #251)', () => {
  it('names Xomoni’s page for every place that needs Xomoni, and none for the others', () => {
    for (const section of SECTIONS) {
      expect(xomoniPageFor(section.id) !== null).toBe(section.needsXomoni);
    }
    expect(xomoniPageFor('comments')).toBe('library');
    expect(xomoniPageFor('health')).toBe('overview');
    expect(xomoniPageFor('settings')).toBe('settings');
  });
});
