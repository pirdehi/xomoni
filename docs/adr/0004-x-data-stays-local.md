# ADR-0004: X data stays in the browser; the cloud stores job status only

- Status: Accepted
- Date: 2026-10-30

## Context

The website lets people follow a cleanup from another device. That needs some data in the cloud, but post text, likes and the inventory are personal and not needed to show progress.

## Decision

Only status leaves the extension: which browsers are connected (`devices`) and per-job counters and states (`jobs`). Post text, likes, the inventory, the activity log, X credentials and cookies stay in the extension's IndexedDB. The schema enforces this by having no columns for such data, and Row Level Security limits every row to its owner.

## Consequences

- The website can show progress but cannot list or search posts.
- A breach of the cloud database would expose account emails and job counters, not X content.
- Adding a column that could hold X content requires a new ADR.
