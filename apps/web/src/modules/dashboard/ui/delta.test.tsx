// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Delta } from './delta';

const text = (node: React.ReactElement) => render(node).container.textContent;

describe('Delta (#252, #254)', () => {
  it('says the change against the period before, with its percentage', () => {
    expect(text(<Delta figure={{ value: 110, previous: 100 }} period="30 days" />)).toBe(
      '+10 (+10%) vs the 30 days before',
    );
    expect(text(<Delta figure={{ value: 90, previous: 100 }} period="7 days" />)).toBe(
      '−10 (−10%) vs the 7 days before',
    );
    expect(text(<Delta figure={{ value: 5, previous: 5 }} period="7 days" />)).toBe('±0 (±0%) vs the 7 days before');
  });

  it('leaves out a percentage of nothing, and gives a rate’s change in points', () => {
    expect(text(<Delta figure={{ value: 6, previous: 0 }} period="30 days" />)).toBe('+6 vs the 30 days before');
    expect(text(<Delta figure={{ value: 3.6, previous: 5 }} period="30 days" unit="%" />)).toBe(
      '−1.4 pt vs the 30 days before',
    );
  });

  it('says when there is nothing to compare', () => {
    expect(text(<Delta figure={{ value: 6, previous: null }} period="all" />)).toBe('all time');
    expect(text(<Delta figure={{ value: 6, previous: null }} period="30 days" />)).toBe('nothing to compare yet');
  });

  it('colors the arrow only where up is good, and judges nothing otherwise', () => {
    const good = render(<Delta figure={{ value: 2, previous: 1 }} period="7 days" upIsGood />).container;
    const bad = render(<Delta figure={{ value: 1, previous: 2 }} period="7 days" upIsGood />).container;
    const plain = render(<Delta figure={{ value: 2, previous: 1 }} period="7 days" />).container;
    const cls = (c: HTMLElement) => c.querySelector('svg')?.getAttribute('class') ?? '';
    // Fluent's icons carry their own classes; a judged arrow adds a color on top.
    expect(cls(good)).not.toBe(cls(bad));
    expect(cls(plain)).not.toBe(cls(good));
    expect(cls(good).length).toBeGreaterThan(cls(plain).length);
  });
});
