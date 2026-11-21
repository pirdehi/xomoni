import { describe, expect, it } from 'vitest';
import {
  PILLARS,
  PILLAR_TEXT,
  PLACES,
  PLACE_STATUSES,
  type Place,
  STATUS_LABEL,
  examplesOf,
  inStatusOrder,
  isAvailable,
} from './footprint';

const planned = PLACES.filter((place) => !isAvailable(place));

describe('the five pillars', () => {
  it('are discover, understand, clean up, protect and shape, in that order, each named and explained', () => {
    expect(PILLARS.map((pillar) => PILLAR_TEXT[pillar].name)).toEqual([
      'Discover',
      'Understand',
      'Clean up',
      'Protect',
      'Shape',
    ]);
    for (const pillar of PILLARS) expect(PILLAR_TEXT[pillar].summary).toMatch(/^[A-Z].+\.$/);
  });
});

describe('the places', () => {
  it('are X today, the person’s email next, and everywhere else later', () => {
    expect(PLACES.map(({ name, status }) => [name, STATUS_LABEL[status]])).toEqual([
      ['X', 'Today'],
      ['Your email', 'Next'],
      ['Everywhere else you are', 'Later'],
    ]);
  });

  it('has X as the only place Xomoni works in today', () => {
    expect(PLACES.filter(isAvailable).map((place) => place.id)).toEqual(['x']);
  });

  it('says what Xomoni does on X for every pillar', () => {
    const x = PLACES.find(isAvailable)!;
    expect(Object.keys(x.does).sort()).toEqual([...PILLARS].sort());
    for (const pillar of PILLARS) expect(x.does[pillar]).toMatch(/^.+\.$/);
  });

  it('never gives a planned place a feature, a date or a promise of availability', () => {
    expect(planned.length).toBeGreaterThan(0);
    for (const place of planned) {
      expect(place).not.toHaveProperty('does');
      // No year, month, quarter or season: nothing beyond X is scheduled.
      expect(place.summary).not.toMatch(
        /\b(20\d\d|Q[1-4]|January|February|March|April|May|June|July|August|September|October|November|December|spring|summer|autumn|fall|winter|soon)\b/i,
      );
      expect(place.summary).not.toMatch(/\b(available now|works now|supports?)\b/i);
    }
  });

  it('says plainly that email is not available yet, and that Xomoni doesn’t read it', () => {
    const email = PLACES.find((place) => place.id === 'email')!;
    expect(email.summary).toContain('not available yet');
    expect(email.summary).toContain('doesn’t open or read your email');
  });

  it('come in status order, and every status has its label', () => {
    expect(inStatusOrder(PLACES)).toEqual(PLACES);
    expect(PLACE_STATUSES.map((status) => STATUS_LABEL[status])).toEqual(['Today', 'Next', 'Later']);
  });
});

describe('inStatusOrder', () => {
  it('puts today first, then next, then later, and keeps the order within each', () => {
    const later1: Place = { id: 'l1', name: 'Later one', status: 'later', summary: '' };
    const later2: Place = { id: 'l2', name: 'Later two', status: 'later', summary: '' };
    const next: Place = { id: 'n', name: 'Next', status: 'next', summary: '' };
    const today = PLACES[0]!;

    expect(inStatusOrder([later1, next, later2, today]).map((place) => place.id)).toEqual(['x', 'n', 'l1', 'l2']);
    expect(inStatusOrder([])).toEqual([]);
  });
});

describe('examplesOf', () => {
  it('gives each pillar X’s line, and nothing from places that are only planned', () => {
    for (const pillar of PILLARS) {
      expect(examplesOf(pillar)).toEqual([{ place: 'X', text: PLACES.find(isAvailable)!.does[pillar] }]);
    }
  });

  it('gives nothing when no place is available yet, and every available place when there are several', () => {
    expect(examplesOf('clean', planned)).toEqual([]);

    const x = PLACES.find(isAvailable)!;
    const another: Place = { ...x, id: 'another', name: 'Another place', does: { ...x.does, clean: 'Clean there.' } };
    expect(examplesOf('clean', [x, ...planned, another])).toEqual([
      { place: 'X', text: x.does.clean },
      { place: 'Another place', text: 'Clean there.' },
    ]);
  });
});
