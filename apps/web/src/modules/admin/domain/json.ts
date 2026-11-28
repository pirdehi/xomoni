// Readers for JSON the console's database functions and the maintainer's published plan return. They never throw: a
// field that is missing or of another type reads as an empty value, so one odd field never hides a whole page.

/** A JSON object read field by field. */
export type JsonObject = Readonly<Record<string, unknown>>;

/** `value` when it is a plain object (not an array or null), otherwise an empty object. */
export function asObject(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : {};
}

/** `value` when it is an array, otherwise an empty one. */
export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `value` when it is a string, otherwise `fallback`. */
export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** `value` when it is a non-empty string, otherwise null. */
export function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * `value` as a finite number: a number, or a string holding one (Postgres sends `bigint` and `numeric` as text in
 * some places); null for anything else.
 */
export function asNullableNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Like {@link asNullableNumber}, with `fallback` (0 by default) for anything that isn't a number. */
export function asNumber(value: unknown, fallback = 0): number {
  return asNullableNumber(value) ?? fallback;
}

/** True only for `true`: a missing flag is off. */
export function asBoolean(value: unknown): boolean {
  return value === true;
}

/** The strings in `value` when it is an array; other items are dropped. */
export function asStringList(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

/** The numeric fields of an object, such as counts by status; other fields are dropped. */
export function asCounts(value: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, raw] of Object.entries(asObject(value))) {
    const n = asNullableNumber(raw);
    if (n !== null) counts[key] = n;
  }
  return counts;
}
