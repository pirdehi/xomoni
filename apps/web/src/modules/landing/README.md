# `modules/landing`: the landing and install pages

The page at `/` that explains Xomoni to a first-time visitor: the problem, how the extension works, its safety rules, what the website adds, what stays private, common questions and how to start. And `/install`, the guide to installing the extension from its latest GitHub release (#44). Both are built on Fluent UI with Xomoni's theme ([ADR-0019](../../../../../docs/adr/0019-fluent-ui-everywhere.md)); their styles are rendered on the server by `shared/ui/fluent-provider.tsx`, so the pages arrive styled.

The module has no data and no actions, so it has only a `ui/` layer.

## Layers

| Layer | Files | Responsibility |
| --- | --- | --- |
| `ui/` | `home-page.tsx`, `content.ts`, `install-page.tsx` | `HomePage`: header, hero with the dashboard screenshot (light or dark, following the visitor's system), the sections, the questions (a Fluent accordion), a closing call to action and the footer. `content.ts` holds the words, so copy changes don't touch the layout. `InstallPage`: the download buttons (the latest release's `xomoni-extension.zip` and every release with its checksums, `docs/RELEASING.md`), four numbered steps and how to update. |

## Rules

- **The copy stays true to the product.** Claims about data and safety match the [privacy policy](../../app/privacy/page.tsx), [ADR-0003](../../../../../docs/adr/0003-no-credentials-no-evasion.md), [ADR-0004](../../../../../docs/adr/0004-x-data-stays-local.md) and [ADR-0006](../../../../../docs/adr/0006-website-is-view-only.md); change them together.
- **Screenshots come from the dashboard preview** with demo data (`npm run preview:ui -w @xomoni/extension`), never from a real X account: `public/screens/overview.png` (light, also the Open Graph image) and `overview-dark.png`, both 1440 × 1000.

## Used by

- `app/page.tsx` and `app/install/page.tsx`.
