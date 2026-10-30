# `packages/db`: the database contract

TypeScript types for the Xomoni Supabase database (`Database`, `Tables<…>`, and the row aliases `DeviceRow` and `JobRow`), generated from [`supabase/migrations`](../../supabase/migrations). Apps import it as `@xomoni/db`.

## Regenerate after a migration

```bash
supabase start                 # or `supabase db reset` to re-apply migrations
npm run gen -w @xomoni/db      # writes src/database.types.ts
```

Never edit `src/database.types.ts` by hand. CI regenerates it from the migrations and fails if the committed file differs.

## Rules

- Only adapters import it: in the website, `shared/supabase` and module `infrastructure/` folders (`web-supabase-behind-adapters`). Domain code uses its own types and maps rows at the boundary.
- `packages-do-not-import-apps`: this package depends on nothing in `apps/`.
