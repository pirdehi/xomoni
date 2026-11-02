# ADR-0015: Architecture styles, principles and patterns, named

- Status: Accepted
- Date: 2026-11-02

## Context

The layer rules are enforced by `npm run arch`, and [ADR-0007](0007-npm-workspaces-monorepo.md) and [ADR-0008](0008-hexagonal-modules-for-the-website.md) record the monorepo and the website's hexagonal modules. What no document said in one place is _which_ architecture Xomoni follows, how the SOLID principles apply, and which design patterns are in use and where (#100). A contributor asking "is this SOLID? is this the Strategy pattern? what architecture is this?" had to infer it from the code.

Three different kinds of answer are often mixed up, so this record keeps them apart:

- An **architecture style** decides how the system is cut into parts and which way dependencies point.
- **Principles** (SOLID) guide how each part's code is shaped. They are not an architecture.
- **Design patterns** (Strategy, Adapter, Observer…) are named solutions to recurring problems inside a part. They are not an architecture either.

## Decision

### 1. Architecture styles

| Level | Style | Where | What it means here |
| --- | --- | --- | --- |
| Repository | **Modular monolith in a monorepo** | npm workspaces: `apps/*`, `packages/*` ([ADR-0007](0007-npm-workspaces-monorepo.md)) | One repository and one version history; units are separate packages whose dependencies are checked. Apps never import each other; shared code lives in `packages/`. |
| Product | **Local-first client with a view-only cloud** | `apps/extension` acts on X; `apps/web` and Supabase only show status ([ADR-0004](0004-x-data-stays-local.md), [ADR-0006](0006-website-is-view-only.md)) | The extension owns all X data and every action. The cloud holds job status only. |
| Website | **Hexagonal architecture (ports and adapters)**, organized as **vertical feature modules**, with the **Clean Architecture dependency rule** | `apps/web/src/modules/<module>/{domain,application,infrastructure,server,client,ui}` ([ADR-0008](0008-hexagonal-modules-for-the-website.md)) | Dependencies point inward: `domain` ← `application` ← adapters (`infrastructure`) and composition roots (`server`, `client`). Use cases see only ports (interfaces); Supabase is an adapter behind them. Routes in `src/app` are thin. |
| Extension | **Layered by execution context, around a shared kernel**, moving to **hexagonal** | `apps/extension/src/{shared,engine,content,inject,background,ui}` ([ARCHITECTURE §5](../ARCHITECTURE.md#5-extension-appsextension)) | Each area runs in its own JavaScript context and talks to the others by messages. `shared/` is the kernel every area may use. Today the engine still calls IndexedDB and `chrome.*` directly; [#11](https://github.com/pirdehi/xomoni/issues/11) moves it behind ports (X tab, storage, notifier, clock), the same shape as the website. |
| Data | **Authorization in the database** | `supabase/migrations`: Row Level Security on every table | The database itself decides who reads which row; the website's checks are a second line, not the only one. |

### 2. How the SOLID principles show up

| Principle | In Xomoni | Example |
| --- | --- | --- |
| **S**ingle responsibility | One reason to change per module and file. | `engine/limiter.ts` only paces; `shared/risk.ts` only derives the risk ladder; `shared/backup.ts` only builds archive files; the website's `auth` and `dashboard` modules change for different reasons. |
| **O**pen/closed | New behavior is added as data or as a new adapter, not by editing the core. | X's limits are rows in `shared/x-limits.ts`, which the limiter reads; pacing presets are a table in `shared/settings.ts`; a new sign-in provider is a new `AuthGateway` adapter. |
| **L**iskov substitution | Any implementation of a port can stand in for another. | Use case tests in `auth/application/use-cases.test.ts` run against an in-memory `AuthGateway`; production uses `infrastructure/supabase-auth-gateway.ts`; the use cases can't tell the difference. |
| **I**nterface segregation | Ports are small and named for what the caller needs. | The dashboard has three ports, `DashboardReader`, `DeviceRegistry` and `LiveFeed` (`dashboard/application/ports.ts`), instead of one "dashboard service". |
| **D**ependency inversion | Use cases depend on ports; composition roots inject the adapters. | `auth/server/deps.ts` (server) and `dashboard/client/live.ts` (browser) build the adapters and pass them in. In the extension this is partial until [#11](https://github.com/pirdehi/xomoni/issues/11). |

Xomoni favors functions and plain data over class hierarchies: there is no inheritance of behavior beyond `Error` subclasses and Dexie's database class, and no dependency-injection container. Wiring is explicit code in a composition root.

### 3. Design patterns in use

| Pattern | Problem it solves here | Where |
| --- | --- | --- |
| Ports and adapters (Gateway) | Keep Supabase out of the use cases. | `apps/web/src/modules/*/application/ports.ts`, `*/infrastructure/supabase-*.ts` |
| Composition root | One place per runtime decides which adapters a use case gets. | `apps/web/src/modules/auth/server/deps.ts`, `apps/web/src/modules/dashboard/client/live.ts` |
| Use case (application service) | One function per thing a person can do, independent of UI and transport. | `apps/web/src/modules/auth/application/use-cases.ts` |
| Data access layer | Every page and action reads the session through one checked path. | `apps/web/src/modules/auth/server/session.ts` (`currentViewer`, `requireViewer`) |
| Data mapper | Database rows become domain types in one place. | `apps/web/src/modules/dashboard/infrastructure/supabase-dashboard.ts` |
| Observer (publish/subscribe) | The UI follows changes without polling. | Realtime `LiveFeed` (website dashboard); `runner.subscribe` with React's `useSyncExternalStore` and Dexie's `useLiveQuery` (`apps/extension/src/ui/hooks.ts`) |
| State machine | A job moves through known states only. | `JobState` in `apps/extension/src/shared/types.ts`, transitions in `apps/extension/src/engine/runner.ts`; the risk ladder's levels 0–4 in `apps/extension/src/shared/risk.ts` |
| Strategy (table-driven) | Choose behavior by kind without a chain of `if`s. | Pacing presets (`shared/settings.ts`), the pages each scan target reads (`engine/scan.ts`, `scanUrls`), the routine per job kind (`engine/runner.ts`, `runSteps`), the action per cleanup target (`shared/filter.ts`, `actionFor`) |
| Command | The engine sends the content script one serializable instruction at a time. | `ActorCommand` in `apps/extension/src/shared/messages.ts`, executed by `apps/extension/src/content/actor.ts` |
| Sliding-window rate limiter | Stay under hourly and daily caps and X's announced limits. | `apps/extension/src/engine/limiter.ts`, limits in `apps/extension/src/shared/x-limits.ts` ([ADR-0012](0012-one-fifth-of-every-x-limit.md)) |
| Circuit breaker | Stop calling X when it pushes back, and resume only after a cool-down. | The risk ladder: `apps/extension/src/shared/risk.ts`, `riskBlock` in `apps/extension/src/engine/context.ts` ([ADR-0013](0013-risk-ladder.md)) |
| Retry with exponential backoff | Ride out offline periods and X outages without hammering X. | `backoffMinutes` and `waitOut` in `apps/extension/src/engine/context.ts` |
| Private message channel | The page-world script hands X's responses to the content script where no page script can listen. | `apps/extension/src/shared/bridge.ts` |
| Typed signals as exceptions | Unwind a job from any depth with a reason the runner understands. | `Stop`, `NeedsYou`, `Interrupted` in `apps/extension/src/engine/context.ts` |
| Single source of truth | A value that must agree everywhere is defined once. | X's limits (`shared/x-limits.ts`), the consent text (`packages/consent`), the database types (`packages/db`) |

### 4. Rules that follow from this

- A change names the style of the unit it touches and follows it: new website behavior is a use case behind a port; new extension behavior goes into the area of the context it runs in.
- A new pattern, or a new use of one listed above in a new place, is added to the table in this record in the same pull request.
- The styles are enforced by the dependency-cruiser rules in [ARCHITECTURE §7](../ARCHITECTURE.md#7-enforced-rules); the documentation gate keeps that list complete.

## Consequences

- Contributors get one answer to "what architecture is this?": a modular monolith; hexagonal feature modules on the website; context layers around a kernel in the extension, moving to hexagonal; SOLID as the guide for code inside them; named patterns where they help.
- The extension's gap (direct IndexedDB and `chrome.*` calls from the engine) is now stated rather than implied; [#11](https://github.com/pirdehi/xomoni/issues/11) closes it.
- This record must be kept current: when code moves, the file paths above move with it.

## Alternatives considered

- **Microservices.** One person maintains Xomoni, and the extension must run offline on the person's computer; separate services would add deployment and network failure modes for no benefit.
- **A dependency-injection container** (InversifyJS, tsyringe). Explicit composition roots are a few lines each, type-check without decorators, and are easier to read.
- **Class hierarchies for strategies** (an abstract `JobRunner` with subclasses). The behaviors are small; tables of functions and data are shorter and easier to test.
