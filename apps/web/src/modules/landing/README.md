# `modules/landing`: the landing and install pages

The page at `/` that explains Xomoni to a first-time visitor: the problem, how the extension works, its safety rules, what the website adds, what stays private, common questions and how to start. And `/install`, the guide to installing the extension from its latest GitHub release (#44). Both are built on Fluent UI with Xomoni's theme ([ADR-0019](../../../../../docs/adr/0019-fluent-ui-everywhere.md)); their styles are rendered on the server by `shared/ui/fluent-provider.tsx`, so the pages arrive styled.

The module has no data and no actions: a pure `domain/` with the install guide's rules, and a `ui/` layer.

## Layers

| Layer | Files | Responsibility |
| --- | --- | --- |
| `domain/` | `install-guide.ts` | The install guide's rules (#299): `platformOf` reads the browser (Chrome, Edge, Brave, another Chromium browser, or one that can't run Xomoni: Firefox, Safari) and the computer (a Mac, Windows, other; phones and tablets, an iPad asking for the desktop page included) from what `navigator` gives (Chromium's brands and platform first, `navigator.brave`, else the user agent). The words that differ: the extensions page (`chrome://`, `edge://`, `brave://extensions`), where *Developer mode* is, how to unzip (double-click on a Mac, *Extract All* on Windows). The five steps in order, the step after the download (unzip) and the one once Xomoni answers (follow it here). |
| `ui/` | `home-page.tsx`, `content.ts`, `install-page.tsx`, `install-guide.tsx` | `HomePage`: header, hero with the dashboard screenshot (light or dark, following the visitor's system), the sections, the questions (a Fluent accordion), a closing call to action and the footer. `content.ts` holds the words, so copy changes don't touch the layout. `InstallPage`: the download buttons (the latest release's `xomoni-extension.zip` and every release with its checksums, `docs/RELEASING.md`); *Where you are*, the getting-started checklist (#244) in a card at the top, live (it looks for Xomoni every few seconds, #299); the steps; how to update. On a phone, only why Xomoni can't be installed there, with nothing to download. `install-guide.tsx` (#299): `usePlatform` (general words on the server and while hydrating, the browser's own after), `CopyText` (an address web pages can't link to, with *Copy*), `useInstallSteps` and `InstallGuide` (the risks, download, unzip, add it to the browser by dragging the folder or with *Load unpacked*, follow it here; one at a time with a progress bar, or all at once with the current one marked; the download moves it on to unzipping, and Xomoni's answer to the last step with the others ticked; the focus follows the person's own moves only) and `PhoneNotice`. |

## Rules

- **The copy stays true to the product.** Claims about data and safety match the [privacy policy](../../app/privacy/page.tsx), [ADR-0003](../../../../../docs/adr/0003-no-credentials-no-evasion.md), [ADR-0004](../../../../../docs/adr/0004-x-data-stays-local.md) and [ADR-0006](../../../../../docs/adr/0006-website-is-view-only.md); change them together.
- **Screenshots come from the dashboard preview** with demo data (`npm run preview:ui -w @xomoni/extension`), never from a real X account: `public/screens/overview.png` (light, also the Open Graph image) and `overview-dark.png`, both 1440 × 1000.

## Tests

Next to each file: `domain/` for every browser and computer; `ui/` in happy-dom (the steps one at a time and all at once, the download, Xomoni's answer, *Copy*, a phone, hydrating without a mismatch). End to end: `e2e/install.spec.ts` (the live checklist ticking when Xomoni opens /welcome in another tab, the download, Edge on Windows, phone width).

## Used by

- `app/page.tsx` and `app/install/page.tsx`.
