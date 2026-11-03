# `modules/landing`: the landing page

The page at `/` that explains Xomoni to a first-time visitor: the problem, how the extension works, its safety rules, what the website adds, what stays private, common questions and how to start. It is built on Fluent UI with Xomoni's theme ([ADR-0019](../../../../../docs/adr/0019-fluent-ui-everywhere.md)); its styles are rendered on the server by `shared/ui/fluent-provider.tsx`, so the page arrives styled.

It has no data and no actions, so it has only a `ui/` layer.

## Layers

| Layer | Files | Responsibility |
| --- | --- | --- |
| `ui/` | `home-page.tsx`, `content.ts` | `HomePage`: header, hero with the dashboard screenshot (light or dark, following the visitor's system), the sections, the questions (a Fluent accordion), a closing call to action and the footer. `content.ts` holds the words, so copy changes don't touch the layout. |

## Rules

- **The copy stays true to the product.** Claims about data and safety match the [privacy policy](../../app/privacy/page.tsx), [ADR-0003](../../../../../docs/adr/0003-no-credentials-no-evasion.md), [ADR-0004](../../../../../docs/adr/0004-x-data-stays-local.md) and [ADR-0006](../../../../../docs/adr/0006-website-is-view-only.md); change them together.
- **Screenshots come from the dashboard preview** with demo data (`npm run preview:ui -w @xomoni/extension`), never from a real X account: `public/screens/overview.png` (light, also the Open Graph image) and `overview-dark.png`, both 1440 × 1000.

## Used by

- `app/page.tsx`.
