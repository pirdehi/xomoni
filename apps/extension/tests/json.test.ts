import { describe, expect, it } from 'vitest';
import { asArray, asId, asNumber, asObject, asString, at } from '../src/shared/json';

describe('reading JSON Xomoni does not control (ADR-0016)', () => {
  it('accepts only plain objects as objects', () => {
    expect(asObject({ a: 1 })).toEqual({ a: 1 });
    for (const value of [null, undefined, [1], 'x', 3, true]) expect(asObject(value)).toBeUndefined();
  });

  it('reads a path, and stops at the first missing or non-object step', () => {
    const json = { data: { user: { result: { rest_id: '42' } } }, list: [{ a: 1 }] };
    expect(at(json, 'data', 'user', 'result', 'rest_id')).toBe('42');
    expect(at(json, 'data', 'nobody', 'result')).toBeUndefined();
    expect(at(json, 'list', '0')).toBeUndefined();
    expect(at('text', 'length')).toBeUndefined();
    expect(at(json)).toBe(json);
  });

  it('gives arrays and strings only when they are of that type', () => {
    expect(asArray([1, 2])).toEqual([1, 2]);
    expect(asArray({ 0: 1 })).toEqual([]);
    expect(asString('a')).toBe('a');
    expect(asString(1)).toBeUndefined();
  });

  it('reads counts sent as numbers or numeric text, and nothing else', () => {
    expect(asNumber(7)).toBe(7);
    expect(asNumber('12')).toBe(12);
    for (const value of ['', ' ', 'abc', NaN, Infinity, null, undefined, {}]) expect(asNumber(value)).toBeUndefined();
  });

  it('reads ids as text, never as rounded numbers or empty strings', () => {
    expect(asId('1234567890123456789')).toBe('1234567890123456789');
    expect(asId(42)).toBe('42');
    expect(asId('')).toBeUndefined();
    expect(asId(1.5)).toBeUndefined();
    expect(asId(null)).toBeUndefined();
  });
});
