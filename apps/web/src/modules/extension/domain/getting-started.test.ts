import { describe, expect, it } from 'vitest';
import { gettingStarted, nextStep } from './getting-started';

const states = (link: Parameters<typeof gettingStarted>[0], signedIn: boolean | null) =>
  gettingStarted(link, signedIn).map((step) => step.state);

describe('getting started (#244)', () => {
  it('ticks each step from what the page sees', () => {
    expect(states('unknown', null)).toEqual(['checking', 'checking', 'checking']);
    expect(states('none', false)).toEqual(['todo', 'todo', 'todo']);
    expect(states('unreachable', true)).toEqual(['todo', 'done', 'todo']);
    expect(states('signed-out', true)).toEqual(['done', 'done', 'todo']);
    expect(states('signed-in', true)).toEqual(['done', 'done', 'done']);
  });

  it('names the first step still to do, or none', () => {
    expect(nextStep(gettingStarted('none', true))?.id).toBe('installed');
    expect(nextStep(gettingStarted('signed-out', false))?.id).toBe('account');
    expect(nextStep(gettingStarted('signed-out', true))?.id).toBe('connected');
    expect(nextStep(gettingStarted('signed-in', true))).toBeNull();
    expect(nextStep(gettingStarted('unknown', null))).toBeNull();
  });
});
