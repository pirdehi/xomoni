# ADR-0007: One repository with npm workspaces

- Status: Accepted
- Date: 2026-10-31

## Context

The extension, the website and the database schema change together (for example, the job states shown on the website mirror the extension's), and share types. They were in one repository with two independent npm projects and two lockfiles, which made shared code and a single quality gate awkward.

## Decision

The repository is an npm workspaces monorepo: `apps/extension`, `apps/web`, `packages/*` for shared code (starting with `packages/db`), plus `supabase/`, `docs/` and `tooling/`. One lockfile at the root. Root scripts run each check across all workspaces. Turborepo is not used yet: the workspace is small, and npm's `--workspaces` covers it.

## Consequences

- Apps never import each other (`apps-are-independent`); shared code moves to a package.
- Vercel builds with Root Directory `apps/web` and installs from the monorepo root.
- Revisit Turborepo (task caching) if CI time becomes a problem.
