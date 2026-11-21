// What a new version may not gain in a one-click update (#305, ADR-0033). Chrome shows the person what an extension
// asks for when it is installed by hand, and asks again when a store update wants more. A version written into
// Xomoni's folder and reloaded gets no such prompt, so a signed release that asks for more than the version running
// is refused: the person installs that one by hand instead. Comparing is deliberately coarse: anything that might
// widen access counts, and only what the version running already had (or less) passes.
import { asArray, asObject, asString } from '../shared/json';

/** The manifest lists of permissions and hosts, compared entry by entry. */
const LISTS = ['permissions', 'optional_permissions', 'host_permissions', 'optional_host_permissions'] as const;

/** Directives that fall back to `default-src` when a policy leaves them out (CSP Level 3). */
const FETCH_DIRECTIVES = [
  'child-src',
  'connect-src',
  'font-src',
  'frame-src',
  'img-src',
  'manifest-src',
  'media-src',
  'object-src',
  'script-src',
  'script-src-elem',
  'script-src-attr',
  'style-src',
  'style-src-elem',
  'style-src-attr',
  'worker-src',
] as const;

/** The strings in `value` when it is a list; anything else in it is kept as its JSON, so it still compares. */
function strings(value: unknown): string[] {
  return asArray(value).map((entry) => asString(entry) ?? JSON.stringify(entry));
}

/** What `next` holds that `old` doesn't, each with `label` in front. */
function added(label: string, old: Iterable<string>, next: Iterable<string>): string[] {
  const before = new Set(old);
  return [...new Set(next)].filter((entry) => !before.has(entry)).map((entry) => `${label}: ${entry}`);
}

/** Every page a manifest's content scripts run on. */
function contentScriptMatches(manifest: Record<string, unknown>): string[] {
  return asArray(manifest.content_scripts).flatMap((script) => strings(asObject(script)?.matches));
}

/** What `externally_connectable` lets reach the extension: page patterns, extension ids and the TLS channel id. */
function connectable(manifest: Record<string, unknown>): string[] {
  const value = manifest.externally_connectable;
  if (value === undefined) return [];
  const entry = asObject(value);
  if (!entry) return [`anything (${JSON.stringify(value)})`];
  return [
    ...strings(entry.matches).map((match) => `page ${match}`),
    ...strings(entry.ids).map((id) => `extension ${id}`),
    ...(entry.accepts_tls_channel_id === true ? ['the TLS channel id'] : []),
  ];
}

/** Each file pages may load from the extension, with who may: `resource for pattern`, one per pair. */
function accessible(manifest: Record<string, unknown>): string[] {
  return asArray(manifest.web_accessible_resources).flatMap((item) => {
    const entry = asObject(item);
    // Manifest V2's plain list: open to every page.
    if (!entry) return [`${JSON.stringify(item)} for every page`];
    const who = [
      ...strings(entry.matches),
      ...strings(entry.extension_ids).map((id) => `extension ${id}`),
      ...(entry.use_dynamic_url === true ? ['a dynamic URL'] : []),
    ];
    return strings(entry.resources).flatMap((resource) => who.map((w) => `${resource} for ${w}`));
  });
}

/** A Content-Security-Policy as `directive → sources`, directive names in lower case. */
export function parseCsp(policy: string): Map<string, string[]> {
  const csp = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name && !csp.has(name.toLowerCase())) csp.set(name.toLowerCase(), sources);
  }
  return csp;
}

/** The sources `directive` allows under `csp`, after the fallbacks; null when nothing restricts it. */
function effective(csp: Map<string, string[]>, directive: string): string[] | null {
  const own = csp.get(directive);
  if (own) return own;
  if (directive === 'worker-src')
    return csp.get('child-src') ?? csp.get('script-src') ?? csp.get('default-src') ?? null;
  if (directive.startsWith('script-src-')) return csp.get('script-src') ?? csp.get('default-src') ?? null;
  if (directive.startsWith('style-src-')) return csp.get('style-src') ?? csp.get('default-src') ?? null;
  if ((FETCH_DIRECTIVES as readonly string[]).includes(directive)) return csp.get('default-src') ?? null;
  return null;
}

/**
 * Where policy `next` allows more than `old`: a directive that no longer restricts, or a source `old` didn't allow for
 * it. A policy that is absent restricts nothing; an added restriction never counts.
 */
function cspWidening(label: string, old: string | undefined, next: string | undefined): string[] {
  if (next === undefined) return old === undefined ? [] : [`${label}: no policy any more`];
  if (old === undefined) return [];
  const before = parseCsp(old);
  const after = parseCsp(next);
  const directives = new Set([...before.keys(), ...after.keys(), ...FETCH_DIRECTIVES, 'default-src']);
  const wider: string[] = [];
  for (const directive of directives) {
    const was = effective(before, directive);
    const now = effective(after, directive);
    if (was === null) continue;
    if (now === null) {
      wider.push(`${label} ${directive}: no longer restricted`);
      continue;
    }
    for (const source of now) {
      if (source !== "'none'" && !was.includes(source)) wider.push(`${label} ${directive}: ${source}`);
    }
  }
  return wider;
}

/** Every policy a manifest sets, by where it applies: `extension_pages` and `sandbox` (or Manifest V2's string). */
function policies(manifest: Record<string, unknown>): Map<string, string> {
  const value = manifest.content_security_policy;
  const found = new Map<string, string>();
  if (typeof value === 'string') found.set('extension_pages', value);
  for (const [where, policy] of Object.entries(asObject(value) ?? {})) {
    found.set(where, asString(policy) ?? '');
  }
  return found;
}

/**
 * What the manifest `next` would let the extension do that `old` doesn't, in words for the activity log; empty when
 * it asks for nothing more. Compared: `permissions`, `optional_permissions`, `host_permissions`,
 * `optional_host_permissions`, the pages content scripts run on, `externally_connectable`,
 * `web_accessible_resources`, `content_security_policy` (each directive's sources, after `default-src`), and leaving
 * incognito's `not_allowed`.
 */
export function widerAccess(old: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const wider = LISTS.flatMap((list) => added(list, strings(old[list]), strings(next[list])));
  wider.push(...added('content_scripts matches', contentScriptMatches(old), contentScriptMatches(next)));
  wider.push(...added('externally_connectable', connectable(old), connectable(next)));
  wider.push(...added('web_accessible_resources', accessible(old), accessible(next)));
  const before = policies(old);
  const after = policies(next);
  for (const where of new Set([...before.keys(), ...after.keys()])) {
    wider.push(...cspWidening(`content_security_policy ${where}`, before.get(where), after.get(where)));
  }
  if (old.incognito === 'not_allowed' && next.incognito !== 'not_allowed') {
    wider.push(`incognito: ${asString(next.incognito) ?? 'allowed'}`);
  }
  return wider;
}
