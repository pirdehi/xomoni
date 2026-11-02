# ADR-0016: Strict TypeScript and type-aware lint in every workspace

- Status: Accepted
- Date: 2026-11-02

## Context

Before this decision (#101):

- Each workspace had its own `tsconfig.json` with different strictness. All had `strict`, but the website and the packages lacked `noUnusedLocals` and `noUnusedParameters`, and none had `noUncheckedIndexedAccess`, so `list[0].id` type-checked even when the list could be empty.
- ESLint ran without type information. It could not see a promise that nobody awaited, an `any` flowing into typed code, a `switch` that missed a case, or a check that could never be false.
- The parsers of X's responses and X's archive used `any` behind `eslint-disable` comments, so a field X renamed or removed would only fail at run time.

Xomoni acts on a person's real X account. A missed case or an unchecked value there is a safety problem, not a style problem.

## Decision

1. **One compiler baseline.** [`tsconfig.base.json`](../../tsconfig.base.json) holds the rules for every workspace: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `forceConsistentCasingInFileNames`, `isolatedModules`. Each workspace's `tsconfig.json` extends it and adds only what its runtime needs (`lib`, `jsx`, `types`, `paths`). Files that run in Node, such as `apps/extension/vite.config.ts`, get their own `tsconfig.node.json`, so Node's globals never leak into browser code.
2. **Type-aware lint.** ESLint uses `typescript-eslint`'s `strictTypeChecked` set with the project service, plus `switch-exhaustiveness-check`. Two options are tuned, not turned off: `no-confusing-void-expression` allows `() => setOpen(false)` handlers, and `restrict-template-expressions` allows numbers.
3. **No `any` for data Xomoni doesn't control.** X's responses, X's archive files, runtime messages and stored settings are typed `unknown` and read through checked helpers (`apps/extension/src/shared/json.ts`). A field that is missing or of another type becomes `undefined`, never a crash or a wrong value.
4. **Promises are handled or visibly ignored.** An event handler that starts async work writes `void work()`, and the work reports its own errors (a toast in the dashboard, an error state on the website).
5. **No rule is switched off inside the code.** `linterOptions.noInlineConfig` makes ESLint ignore `eslint-disable` comments, and `@ts-ignore` is banned. A rule changes only in `eslint.config.mjs`, with a comment that says why, and an ADR. The scoped exceptions today:
   - **Tests** (`*.test.ts`, `tests/`, `e2e/`): non-null assertions (a missing value fails the test anyway), async callbacks without `await`, unbound methods (mocks are asserted through them), and `no-unsafe-assignment` (Vitest types `expect.any(…)` as `any`).
   - **The page-world interceptor** (`apps/extension/src/inject/interceptor.ts`): `unbound-method`, because keeping X's own `fetch` and `XMLHttpRequest` methods to call later with the page's `this` is the whole point of that file.
   - **Plain JavaScript** (configs, scripts, tooling): the type-checked rules, since there are no types to check.

`npm run verify` runs both `tsc` (per workspace) and ESLint, in the pre-push hook and in CI.

## Consequences

- An empty list, a renamed X field or a forgotten `case` is a compile or lint error instead of a run-time surprise on someone's account.
- Code reads a little longer where it meets the outside world (`asString(at(user, 'core', 'screen_name')) ?? ''` instead of `user.core.screen_name`). That cost sits in the parsers, where the safety matters.
- Lint is slower (about 15 s for the repository), because it type-checks.
- New code must meet these rules from the first commit; the contribution guide states them.

## Alternatives considered

- **`exactOptionalPropertyTypes`.** It would make every optional React prop and every partial Dexie update spell out `undefined`. Revisit when the libraries' types support it well.
- **`verbatimModuleSyntax`.** The `consistent-type-imports` lint rule already keeps type imports separate, and Next.js compiles the website its own way.
- **Biome instead of ESLint.** Faster, but without type-aware rules such as `no-floating-promises` and `no-unsafe-*`, which are the point here.
- **Inline `eslint-disable` with a reason.** Easy to add and easy to forget; a central list of exceptions is reviewable in one place.
