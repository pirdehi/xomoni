// Safe reading of JSON whose shape Xomoni does not control: X's GraphQL responses and the files of X's data
// archive. X changes these often, so every read checks the type it gets and falls back to `undefined`
// instead of trusting a field to exist (ADR-0016: no `any` in product code).

/** A parsed JSON object about whose fields nothing is known yet. */
export type JsonObject = Record<string, unknown>;

/** `value` as an object, or undefined when it is null, an array or not an object. */
export function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

/** `value` as an array, or an empty array when it is not one. */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** `value` when it is a string, else undefined. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A finite number from a number or a numeric string (X sends counts both ways), else undefined. */
export function asNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** An id as text: a string as it is, or a whole number written out; else undefined. */
export function asId(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  return typeof value === 'number' && Number.isInteger(value) ? String(value) : undefined;
}

/** The value at `path` inside `value`, or undefined as soon as a step is missing or not an object. */
export function at(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) current = asObject(current)?.[key];
  return current;
}
