# ADR-0019: Fluent UI for every Xomoni interface; Tailwind is removed

- Status: Accepted
- Date: 2026-11-03

## Context

The extension dashboard and xomoni.com were styled with Tailwind CSS 4: utility classes in the markup, our own small component set (`Badge`, `Button`, `Modal`, …) and `lucide-react` icons. The maintainer wants the interfaces to look more polished, and decided (#123) that no interface uses Tailwind. The options compared were Mantine, Radix Themes, MUI, Fluent UI and Ionic. Ionic was judged a poor fit for a desktop dashboard: it looks like a phone app and brings its own routing. The maintainer chose **Fluent UI** for every interface.

Constraints:

- Both apps run React 19. The dashboard is a Manifest V3 extension page: no remote code, and the default extension CSP, which does not restrict styles. The website sends `style-src 'self' 'unsafe-inline'`.
- Tests find elements by role, label and text ([ADR-0017](0017-test-standard.md)), so the markup can change without rewriting them.
- A Persian, right-to-left interface is planned.

## Decision

1. **Fluent UI React v9** (`@fluentui/react-components`, with `@fluentui/react-icons`) is the component library of the extension dashboard and of xomoni.com. Styles are written with Fluent's `makeStyles` and theme `tokens`, never with literal colors, sizes or utility classes.
2. **One theme per mode, Xomoni's:** Fluent's web themes built from Xomoni's blue as the brand ramp (shade 80 is `#2a78d6`), with the dashboard's warm neutrals and Vazirmatn in the font stack (`apps/extension/src/ui/fluent.tsx`). It follows the theme chosen in Settings, or the operating system's.
3. **Status colors come from Fluent's status tokens** (`colorStatusSuccess…`, `colorStatusWarning…`, `colorStatusDanger…`), so light and dark stay legible.
4. **Tailwind is removed** from both apps in stages (#123): the extension dashboard first (job card, then every page and component), then xomoni.com, whose home page and public pages are redesigned on Fluent and whose styles are rendered on the server (Griffel SSR in Next.js).
5. **Tests stay semantic.** Components expose state through roles and ARIA (`progressbar` with `aria-valuenow`, `status`) or `data-status` and `data-tone` attributes, never through class names. Fluent's animations are switched off in the test DOM, as in browsers without the Web Animations API.

## Consequences

- One look and one accessible component set across the extension and the website, with keyboard support, focus handling and right-to-left layouts built in.
- The extension bundle grows: Fluent and its icons are tree-shaken, but larger than utility CSS.
- Styles are generated at runtime by Griffel. The website needs server rendering of those styles to avoid a flash of unstyled content.
- While the migration runs, Tailwind and Fluent coexist: the provider's element takes no part in the layout (`display: contents`) and has no background, so pages not yet migrated keep their look.
- Reviews reject new Tailwind classes and literal colors in components.

## Alternatives considered

- **Mantine 8:** the strongest dashboard component set, with CSS Modules. It was not chosen: the maintainer preferred Fluent's look.
- **Radix Themes, MUI:** fewer ready-made dashboard pieces (Radix), or a heavier runtime and a Google look (MUI).
- **Ionic React:** built for mobile apps. It looks like one on a desktop dashboard and imposes its own routing.
- **Keep Tailwind with our own components:** what we had; the maintainer wants a richer, consistent design system instead.
