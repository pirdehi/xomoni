import { describe, expect, it } from 'vitest';
import {
  asArray,
  asBoolean,
  asCounts,
  asNullableNumber,
  asNullableString,
  asNumber,
  asObject,
  asString,
  asStringList,
} from './json';

describe('JSON readers', () => {
  it('read objects and arrays, and nothing else, as such', () => {
    expect(asObject({ a: 1 })).toEqual({ a: 1 });
    for (const odd of [null, undefined, 1, 'x', [1]]) expect(asObject(odd)).toEqual({});
    expect(asArray([1, 2])).toEqual([1, 2]);
    for (const odd of [null, undefined, {}, 'x']) expect(asArray(odd)).toEqual([]);
  });

  it('read strings, with a fallback, and non-empty strings or null', () => {
    expect(asString('a')).toBe('a');
    expect(asString(1)).toBe('');
    expect(asString(null, 'none')).toBe('none');
    expect(asNullableString('a')).toBe('a');
    expect(asNullableString('')).toBeNull();
    expect(asNullableString(3)).toBeNull();
  });

  it('read finite numbers, also from text, and nothing else', () => {
    expect(asNullableNumber(3)).toBe(3);
    expect(asNullableNumber('12.5')).toBe(12.5);
    for (const odd of [NaN, Infinity, '', ' ', 'x', null, undefined, {}, true])
      expect(asNullableNumber(odd)).toBeNull();
    expect(asNumber('x')).toBe(0);
    expect(asNumber(undefined, 7)).toBe(7);
  });

  it('read only true as on', () => {
    expect(asBoolean(true)).toBe(true);
    for (const odd of [false, 'true', 1, null]) expect(asBoolean(odd)).toBe(false);
  });

  it('keep only the strings of a list and only the numbers of a count object', () => {
    expect(asStringList(['email', 2, null, 'google'])).toEqual(['email', 'google']);
    expect(asStringList('email')).toEqual([]);
    expect(asCounts({ done: 3, todo: '2', note: 'x', none: null })).toEqual({ done: 3, todo: 2 });
    expect(asCounts([1, 2])).toEqual({});
  });
});
