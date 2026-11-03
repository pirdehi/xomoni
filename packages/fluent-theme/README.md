# @xomoni/fluent-theme

Xomoni's [Fluent UI](https://react.fluentui.dev) themes ([ADR-0019](../../docs/adr/0019-fluent-ui-everywhere.md)), one source for the extension dashboard and xomoni.com.

| Export | What it is |
| --- | --- |
| `XOMONI_BRAND` | Xomoni's blue (`#2a78d6` at shade 80) in Fluent's 16 brand shades. |
| `xomoniLightTheme(font?)`, `xomoniDarkTheme(font?)` | Fluent's web themes with that brand ramp and Xomoni's warm neutrals. An app that loads its own font passes it. |
| `XOMONI_FONT` | The system font stack, with Vazirmatn for Persian text. |
| `themeVariables(theme)` | A theme as CSS custom property declarations, the variables Fluent's provider sets. xomoni.com puts the dark theme's under `prefers-color-scheme: dark`, so server-rendered pages never flash. |
| `PAGE_BACKGROUND` | The page color in each mode, equal to the theme's `colorNeutralBackground3`, for CSS that paints the page before React mounts. |

Depends on `@fluentui/react-components` (a peer dependency; each app installs it). Tests: `npm test -w @xomoni/fluent-theme`.
