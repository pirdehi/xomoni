// Architecture rules for the whole monorepo, checked by `npm run arch` (pre-push hook and CI).
// Every rule name here is documented in docs/ARCHITECTURE.md; `npm run docs:check` fails if one is not.
// Paths are relative to the repository root.

const WEB = '^apps/web/src';
const EXT = '^apps/extension/src';
const MODULE = `${WEB}/modules/([^/]+)`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ── Whole repository ──────────────────────────────────────────────────────────────
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Import cycles make modules impossible to reason about or test alone.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      comment: 'Every import must resolve to a file or an installed package.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'apps-are-independent',
      severity: 'error',
      comment: 'Apps never import each other; share code through packages/.',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'packages-do-not-import-apps',
      severity: 'error',
      comment: 'Packages are leaves: apps depend on packages, never the reverse.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },

    // ── Website: layers inside a module ───────────────────────────────────────────────
    {
      name: 'web-domain-is-pure',
      severity: 'error',
      comment: 'Domain code is plain TypeScript: no framework, SDK, I/O or other layers. Only its own domain files.',
      from: { path: `${MODULE}/domain/` },
      to: { pathNot: [`${WEB}/modules/$1/domain/`, 'node_modules/zod/'] },
    },
    {
      name: 'web-application-depends-on-domain',
      severity: 'error',
      comment: 'Use cases see only their own domain and ports; adapters are injected.',
      from: { path: `${MODULE}/application/` },
      to: { pathNot: `${WEB}/modules/$1/(domain|application)/` },
    },
    {
      name: 'web-infrastructure-is-an-adapter',
      severity: 'error',
      comment: 'Adapters implement ports; they never reach into UI, composition roots, routes or other modules.',
      from: { path: `${MODULE}/infrastructure/` },
      to: { path: [`${WEB}/app/`, `${WEB}/modules/[^/]+/(ui|server|client)/`] },
    },
    {
      name: 'web-ui-has-no-data-access',
      severity: 'error',
      comment: 'UI renders and calls actions; it never talks to Supabase, adapters or use cases directly.',
      from: { path: `${MODULE}/ui/` },
      to: {
        path: [
          `${WEB}/modules/[^/]+/(application|infrastructure)/`,
          `${WEB}/shared/supabase/`,
          'node_modules/@supabase/',
        ],
      },
    },
    {
      name: 'web-ui-uses-server-actions-only',
      severity: 'error',
      comment: "From server/, UI may import only Server Actions ('use server' files).",
      from: { path: `${MODULE}/ui/` },
      to: { path: `${WEB}/modules/[^/]+/server/`, pathNot: `${WEB}/modules/[^/]+/server/actions\\.ts$` },
    },
    {
      name: 'web-client-is-browser-only',
      severity: 'error',
      comment: 'The browser composition root must not pull in server code.',
      from: { path: `${MODULE}/client/` },
      to: { path: [`${WEB}/modules/[^/]+/server/`, `${WEB}/shared/supabase/(server|proxy)\\.ts$`] },
    },
    {
      name: 'web-modules-talk-through-public-surface',
      severity: 'error',
      comment: "A module may use another module only through that module's server/ or ui/ folders.",
      from: { path: `${MODULE}/` },
      to: {
        path: `${WEB}/modules/[^/]+/(domain|application|infrastructure|client)/`,
        pathNot: `${WEB}/modules/$1/`,
      },
    },
    {
      name: 'web-routes-are-thin',
      severity: 'error',
      comment: 'Routes in app/ compose modules through server/ and ui/ only.',
      from: { path: [`${WEB}/app/`, `${WEB}/proxy\\.ts$`] },
      to: { path: `${WEB}/modules/[^/]+/(domain|application|infrastructure|client)/` },
    },
    {
      name: 'web-shared-is-shared',
      severity: 'error',
      comment: 'shared/ serves every module, so it may not depend on any module or route.',
      from: { path: `${WEB}/shared/` },
      to: { path: [`${WEB}/modules/`, `${WEB}/app/`] },
    },
    {
      name: 'web-supabase-behind-adapters',
      severity: 'error',
      comment: 'Only shared/supabase and module infrastructure/ may import the Supabase SDK or database types.',
      from: { path: `${WEB}/`, pathNot: [`${WEB}/shared/supabase/`, `${MODULE}/infrastructure/`] },
      to: { path: ['node_modules/@supabase/', '^packages/db/'] },
    },

    // ── Extension: areas ──────────────────────────────────────────────────────────────
    {
      name: 'ext-shared-is-the-kernel',
      severity: 'error',
      comment: 'shared/ holds types, parsers and storage used everywhere; it depends on no other area.',
      from: { path: `${EXT}/shared/` },
      to: { path: `${EXT}/(?!shared/)` },
    },
    {
      name: 'ext-engine-is-headless',
      severity: 'error',
      comment: 'The engine (runner, limiter, cleanup, scan) has no UI and never imports page scripts.',
      from: { path: `${EXT}/engine/` },
      to: { path: `${EXT}/(?!engine/|shared/)` },
    },
    {
      name: 'ext-content-is-isolated',
      severity: 'error',
      comment: "The content script runs inside x.com's tab; it shares only types and parsers with the rest.",
      from: { path: `${EXT}/content/` },
      to: { path: `${EXT}/(?!content/|shared/)` },
    },
    {
      name: 'ext-inject-is-isolated',
      severity: 'error',
      comment: "The page-world interceptor runs in X's own JavaScript context; it may use shared/ only.",
      from: { path: `${EXT}/inject/` },
      to: { path: `${EXT}/(?!inject/|shared/)` },
    },
    {
      name: 'ext-background-is-thin',
      severity: 'error',
      comment: 'The service worker stores observations and opens the dashboard; it does not import UI or page scripts.',
      from: { path: `${EXT}/background/` },
      to: { path: `${EXT}/(?!background/|shared/|engine/)` },
    },
    {
      name: 'ext-ui-stays-out-of-the-page',
      severity: 'error',
      comment: 'The dashboard UI drives the engine; it never imports content, inject or background code.',
      from: { path: `${EXT}/ui/` },
      to: { path: `${EXT}/(content|inject|background|dev)/` },
    },
    {
      name: 'ext-dev-is-not-shipped',
      severity: 'error',
      comment: 'dev/ holds the UI preview with demo data; product code never imports it.',
      from: { path: EXT, pathNot: `${EXT}/dev/` },
      to: { path: `${EXT}/dev/` },
    },
  ],
  required: [
    {
      name: 'web-server-code-is-server-only',
      severity: 'error',
      comment: "Composition roots in server/ import 'server-only', so a client import fails the build.",
      module: { path: `${WEB}/(modules/[^/]+/server/|shared/supabase/server\\.ts$)`, pathNot: 'actions\\.ts$' },
      to: { path: 'node_modules/server-only/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['/\\.next/', '/dist/', '/coverage/', '\\.d\\.ts$', '\\.(test|spec)\\.tsx?$'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.arch.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      archi: {
        collapsePattern:
          '^(apps/web/src/modules/[^/]+/[^/]+|apps/web/src/(app|shared)/[^/]+|apps/extension/src/[^/]+|packages/[^/]+)',
      },
      text: { highlightFocused: true },
    },
  },
};
