// The shape of docs/ (#344, ADR-0041): the living documents at its root, on an explicit list; dated reports, reviews
// and plans in docs/reports/<yyyy-mm>/; and docs/README.md, the map, linking every living document and every folder.
// tooling/check-docs.mjs runs it as part of `npm run docs:check`; tooling/docs-layout.test.mjs tests it. Pure but for
// reading files under the root it is given.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

/** The documentation folder, from the repository's root. */
export const DOCS_DIR = 'docs';

/** The map of docs/: what each document is for and when to read it. */
export const DOCS_MAP = `${DOCS_DIR}/README.md`;

/** Where dated reports, reviews and plans go, one folder per month: `docs/reports/<yyyy-mm>/`. */
export const REPORTS_DIR = `${DOCS_DIR}/reports`;

/**
 * The files allowed at the root of docs/, besides the map: documents kept current, which scripts, workflows, the pull
 * request template and other documents link by path. A new one is added here and to the map in the same pull request;
 * anything dated goes under {@link REPORTS_DIR} instead.
 */
export const LIVING_DOCS = Object.freeze([
  'ARCHITECTURE.md',
  'PLAYBOOK.fa.md',
  'PLAYBOOK.md',
  'QUALITY-GATES.md',
  'RELEASING.md',
  'RESEARCH.md',
  'ROADMAP.md',
  'STORE-LISTING.md',
  'TESTING.md',
  'features.json',
]);

/** A month folder under {@link REPORTS_DIR}: `2026-11`. */
export const MONTH_FOLDER = /^\d{4}-(?:0[1-9]|1[0-2])$/;

/**
 * The targets of the Markdown links in `text`, `[label](target "title")`, in order, leaving out those inside fenced
 * code blocks and inline code, which are examples rather than links.
 */
export function markdownLinks(text) {
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return [...prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(([, target]) => target);
}

/**
 * The repository-relative paths that the relative links in the Markdown file `file` (repository-relative) point to,
 * without their `#anchor` and with a folder's trailing slash dropped. Web, mail and same-page links are left out.
 */
export function linkedPaths(file, text) {
  const paths = new Set();
  for (const target of markdownLinks(text)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
    const path = decodeURIComponent(target.split('#')[0]);
    if (path) paths.add(posix.normalize(posix.join(posix.dirname(file), path)).replace(/\/$/, ''));
  }
  return paths;
}

/**
 * What is wrong with the shape of docs/ under `root`, each `path: what`. Files whose name starts with a dot (such as
 * `.DS_Store`) are ignored. `living` replaces {@link LIVING_DOCS}, for tests.
 */
export function checkDocsLayout(root, living = LIVING_DOCS) {
  const problems = [];
  const fail = (path, message) => problems.push(`${path}: ${message}`);
  const full = (path) => join(root, path);
  const entries = (path) =>
    existsSync(full(path))
      ? readdirSync(full(path))
          .filter((name) => !name.startsWith('.'))
          .sort()
      : [];
  const isFolder = (path) => statSync(full(path)).isDirectory();

  const allowed = new Set(['README.md', ...living]);
  const folders = [];
  for (const name of entries(DOCS_DIR)) {
    const path = `${DOCS_DIR}/${name}`;
    if (isFolder(path)) folders.push(path);
    else if (!allowed.has(name))
      fail(
        path,
        `not a living document. Put a dated report, review or plan under ${REPORTS_DIR}/<yyyy-mm>/ and a how-to under ` +
          `${DOCS_DIR}/guides/. A new living document goes on LIVING_DOCS in tooling/docs-layout-lib.mjs and in ` +
          `${DOCS_MAP}.`,
      );
  }
  for (const name of living) {
    if (!existsSync(full(`${DOCS_DIR}/${name}`)))
      fail(`${DOCS_DIR}/${name}`, 'is on LIVING_DOCS in tooling/docs-layout-lib.mjs but missing: take it off the list');
  }

  for (const name of entries(REPORTS_DIR)) {
    const path = `${REPORTS_DIR}/${name}`;
    if (name === 'README.md') continue;
    if (!isFolder(path)) fail(path, `put it in its month's folder, ${REPORTS_DIR}/<yyyy-mm>/`);
    else if (!MONTH_FOLDER.test(name))
      fail(path, `a reports folder is named after its month, <yyyy-mm>, such as 2026-11`);
  }

  if (!existsSync(full(DOCS_MAP))) {
    fail(DOCS_MAP, 'missing: the map of docs/ says what each document is for and when to read it');
    return problems;
  }
  const linked = linkedPaths(DOCS_MAP, readFileSync(full(DOCS_MAP), 'utf8'));
  for (const name of living) {
    const path = `${DOCS_DIR}/${name}`;
    if (existsSync(full(path)) && !linked.has(path))
      fail(DOCS_MAP, `does not link ${name}: the map links every living document`);
  }
  for (const path of folders) {
    if (!linked.has(path) && !linked.has(`${path}/README.md`))
      fail(DOCS_MAP, `does not link the folder ${path.slice(DOCS_DIR.length + 1)}/: the map links every folder`);
  }
  return problems;
}
