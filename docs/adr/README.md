# Architecture decision records

Why Xomoni is built the way it is. Each record captures one decision; see [ADR-0001](0001-record-architecture-decisions.md) for the format and [`template.md`](template.md) to write a new one.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-drive-x-ui-not-the-api.md) | Drive X's own UI instead of the X API | Accepted |
| [0003](0003-no-credentials-no-evasion.md) | Never touch X credentials or session cookies, and never evade detection | Accepted |
| [0004](0004-x-data-stays-local.md) | X data stays in the browser; the cloud stores job status only | Accepted |
| [0005](0005-supabase-and-vercel.md) | Supabase and Vercel for accounts and the website | Accepted |
| [0006](0006-website-is-view-only.md) | The website cannot start deletions | Accepted |
| [0007](0007-npm-workspaces-monorepo.md) | One repository with npm workspaces | Accepted |
| [0008](0008-hexagonal-modules-for-the-website.md) | Hexagonal feature modules for the website, enforced by dependency-cruiser | Accepted |
| [0009](0009-documentation-is-a-merge-gate.md) | Documentation is a merge gate | Accepted |
| [0010](0010-configuration-as-code.md) | Configuration as code | Accepted |
