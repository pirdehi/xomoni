// Xomoni's version numbers (`major.minor.patch`, as in `manifest.json`), compared as numbers. Used by the update notice
// (`cloud/release.ts`, #151) and by the one-click update (`update/`, #305), which never installs an older version.

const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

/** `version` as three numbers, or null when it isn't one. */
function rank(version: string): [number, number, number] | null {
  const m = VERSION.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whether `value` is a version Xomoni writes: three numbers of at most four digits, `0.5.0`, never `v0.5.0`. */
export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION.test(value);
}

/** Whether version `a` is newer than `b`, comparing numbers (0.10.0 is after 0.9.0). False when either isn't a version. */
export function isNewer(a: string, b: string): boolean {
  const x = rank(a);
  const y = rank(b);
  if (!x || !y) return false;
  const [major, minor, patch] = x;
  const [otherMajor, otherMinor, otherPatch] = y;
  if (major !== otherMajor) return major > otherMajor;
  return minor !== otherMinor ? minor > otherMinor : patch > otherPatch;
}
