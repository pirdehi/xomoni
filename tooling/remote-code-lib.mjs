// Finds remotely hosted or string-built code in the extension (#301). Manifest V3 and both stores forbid running code
// that isn't in the package: every script must ship inside the zip, and nothing may be built from a string. The
// command line is tooling/check-remote-code.mjs; tooling/remote-code.test.mjs tests these helpers.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

// Matches `//host` or `http(s)://host` at the start of a quoted string.
const REMOTE = String.raw`(?:https?:)?\/\/`;

/**
 * What may not appear in a shipped script or page: each way to run code from a string, and each way to load code from
 * another site. Deliberately strict, so a false alarm is a prompt to look, never a reason to ship.
 */
export const CODE_RULES = [
  { name: 'eval()', pattern: /(?<![\w$])eval\s*\(/ },
  { name: 'new Function()', pattern: /\bnew\s+Function\s*\(/ },
  { name: 'Function() called with a string', pattern: /(?<!\bnew\s+)(?<![\w$.])Function\s*\(\s*['"`]/ },
  { name: 'setTimeout or setInterval with a string', pattern: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/ },
  { name: 'importScripts()', pattern: /\bimportScripts\s*\(/ },
  { name: 'import of a remote URL', pattern: new RegExp(String.raw`\b(?:import|from)\s*\(?\s*['"\x60]${REMOTE}`) },
  {
    name: 'a Worker from a remote URL',
    pattern: new RegExp(String.raw`\bnew\s+(?:Shared)?Worker\s*\(\s*['"\x60]${REMOTE}`),
  },
  { name: 'executeScript with code', pattern: /\bexecuteScript\s*\(\s*\{[^}]*\bcode\s*:/ },
  { name: 'WebAssembly compiled at run time', pattern: /\bWebAssembly\.(?:instantiate|compile)(?:Streaming)?\b/ },
];

/** What may not appear in a shipped HTML page: scripts from elsewhere, and inline scripts the CSP would block. */
export const PAGE_RULES = [
  {
    name: '<script> from a remote URL',
    pattern: new RegExp(String.raw`<script\b[^>]*\bsrc\s*=\s*['"]?${REMOTE}`, 'i'),
  },
  { name: 'an inline <script>', pattern: /<script\b(?![^>]*\bsrc\s*=)[^>]*>\s*[^<\s]/i },
  { name: 'an inline event handler', pattern: /<[a-z][^>]*\son[a-z]+\s*=/i },
];

/** The problems in one script's or page's text, as `file: what` lines; `page` adds the HTML rules. */
export function textProblems(file, text, page = false) {
  const rules = page ? [...CODE_RULES, ...PAGE_RULES] : CODE_RULES;
  return rules.filter(({ pattern }) => pattern.test(text)).map(({ name }) => `${file}: ${name}`);
}

/** A CSP string as `directive → sources`. */
export function parseCsp(policy) {
  return new Map(
    policy
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name.toLowerCase(), sources]),
  );
}

/** The sources that decide where scripts and workers come from, after CSP's fallbacks. */
function effective(csp, ...directives) {
  for (const directive of directives) if (csp.has(directive)) return csp.get(directive);
  return null;
}

/**
 * The problems in a manifest: an extension-page CSP that would let code in from elsewhere or from a string, and a
 * script the manifest names that is a URL or isn't in the bundle. `has(path)` says whether the bundle has a file.
 */
export function manifestProblems(manifest, has) {
  const problems = [];
  const policy = manifest.content_security_policy?.extension_pages;
  if (typeof policy === 'string') {
    const csp = parseCsp(policy);
    const checks = [
      ['script-src', effective(csp, 'script-src', 'default-src')],
      ['worker-src', effective(csp, 'worker-src', 'child-src', 'script-src', 'default-src')],
      ['object-src', effective(csp, 'object-src', 'default-src')],
    ];
    for (const [name, sources] of checks) {
      if (sources == null) problems.push(`manifest.json: the CSP sets no ${name} (nor default-src)`);
      else
        for (const source of sources.filter((s) => s !== "'self'" && s !== "'none'"))
          problems.push(`manifest.json: the CSP's ${name} allows ${source}`);
    }
  }
  const scripts = [
    manifest.background?.service_worker,
    ...(manifest.content_scripts ?? []).flatMap((cs) => cs.js ?? []),
  ].filter((s) => s != null);
  for (const script of scripts) {
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(script)) problems.push(`manifest.json: script ${script} is a URL`);
    else if (!has(script)) problems.push(`manifest.json: script ${script} is not in the bundle`);
  }
  return problems;
}

/** Every file under `dir`, as `/`-separated paths relative to it. */
function filesUnder(dir) {
  const files = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(relative(dir, path).split(sep).join('/'));
    }
  };
  walk(dir);
  return files.sort();
}

/**
 * The problems in a built extension (`apps/extension/dist`): every script and page against the rules above, the
 * manifest, and each page's `<script src>`, which must name a file in the bundle. Empty when the bundle is clean.
 */
export function bundleProblems(dir) {
  if (!existsSync(join(dir, 'manifest.json'))) return [`${dir}: no manifest.json; build the extension first`];
  const files = filesUnder(dir);
  const has = (path) => files.includes(posix.normalize(path.replace(/^\.?\//, '')));
  const problems = manifestProblems(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')), has);
  for (const file of files) {
    if (/\.(?:m?js|cjs)$/.test(file)) problems.push(...textProblems(file, readFileSync(join(dir, file), 'utf8')));
    if (/\.html?$/.test(file)) {
      const text = readFileSync(join(dir, file), 'utf8');
      problems.push(...textProblems(file, text, true));
      for (const [, src] of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*['"]?([^'"\s>]+)/gi)) {
        const local = posix.join(posix.dirname(file), src);
        if (!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src) && !has(local))
          problems.push(`${file}: <script src="${src}"> is not in the bundle`);
      }
    }
  }
  return problems;
}
