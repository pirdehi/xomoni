# @xomoni/fluent-theme

Xomoni's [Fluent UI](https://react.fluentui.dev) themes ([ADR-0019](../../docs/adr/0019-fluent-ui-everywhere.md)), one source for the extension dashboard and xomoni.com.

| Export | What it is |
| --- | --- |
| `XOMONI_BRAND` | Xomoni's blue (`#2a78d6` at shade 80) in Fluent's 16 brand shades. |
| `XOMONI_BRAND_AA` | Xomoni's blue, a shade deeper, for light mode's buttons and blue text, and dark mode's primary button while hovered: Xomoni's blue itself carries white text at only 4.4:1. |
| `xomoniLightTheme(font?)`, `xomoniDarkTheme(font?)` | Fluent's web themes with that brand ramp and Xomoni's warm neutrals. An app that loads its own font passes it. Text meets WCAG AA (4.5:1) on every surface, which the tests check (#342), the blue a quiet button's text turns while hovered or selected, and a primary button's text at rest, hovered, pressed and selected included (#345). |
| `XOMONI_FONT` | The system font stack, with Vazirmatn for Persian text. |
| `themeVariables(theme)` | A theme as CSS custom property declarations, the variables Fluent's provider sets. xomoni.com puts the dark theme's under `prefers-color-scheme: dark`, so server-rendered pages never flash. |
| `PAGE_BACKGROUND` | The page color in each mode, equal to the theme's `colorNeutralBackground3`, for CSS that paints the page before React mounts. |

Depends on `@fluentui/react-components` (a peer dependency; each app installs it). Tests: `npm test -w @xomoni/fluent-theme`.
