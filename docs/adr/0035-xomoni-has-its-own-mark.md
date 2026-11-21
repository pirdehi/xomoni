# ADR-0035: Xomoni has its own mark, and never shows a platform's to stand for itself or for the platform

- Status: Accepted
- Date: 2026-11-21

## Context

Xomoni's icon was a white stroke crossing a shorter blue one on a near-black rounded square. It was meant as an X being erased, but it looked like X Corp's own logo. Xomoni works on X, so the stores may read a mark like X's as a claim of affiliation. [docs/STORE-LISTING.md](../STORE-LISTING.md) §10 named it as the likeliest cause of a trademark refusal in the Chrome Web Store. The extension's connection map also drew X as the 𝕏 glyph on a dark disc, which is X's own presentation of its name, and that shows in the store's fifth screenshot.

Xomoni is now *Xomoni — Digital footprint manager* (#312): it manages a person's own digital footprint, on X today, and on their email and other places later. A mark tied to one platform's letter would not fit the product, even without the trademark risk.

The icon is drawn in code (`apps/extension/scripts/icon.mjs`). The extension, the stores and the website keep copies of it as PNGs.

## Decision

1. **Xomoni's mark** (#322) is two shoe prints walking up and to the right on a rounded tile of Xomoni's blue. The tile is a gradient from the brand ramp's shade 90 (`#4387db`) to shade 70 (`#1e589f`), from `packages/fluent-theme`. The newer step is white. The older one is white at 42 % over the tile, so it is fading but still there. Together they show a footprint being tidied, under the person's control. The mark holds no letter, no bird, no envelope and no other platform's shape or color.
2. **It is drawn in code, once.** Every copy comes from `icon.mjs`:
   - the extension's icons;
   - the website's favicon, Apple touch icon and header logo, which Supabase's emails also load;
   - the stores' icons, and the screenshots and promo tile that show it.

   `tooling/brand.test.mjs` fails when a committed copy no longer matches the drawing, or has the wrong size.
3. **No platform's mark stands for Xomoni or for the platform it works on.** Xomoni names a platform in words ("X", "X account", later an email provider by name). It doesn't use the platform's logo, its letter glyph (such as 𝕏) or its brand colors. The connection map shows the X account as a generic person icon with the words *X account*. `tooling/brand.test.mjs` fails if 𝕏 or 𝐗 appears in the extension's or the website's shipped source.
4. **The exception** is a third party's own button or link, where that party asks for its mark and the mark stands only for it: *Sign in with Google*, and the link to Xomoni's code on GitHub. Neither stands for Xomoni.

## Consequences

- The listing no longer depends on X's trademark for its look. §10 question 2 of the store listing is answered.
- People who know the old icon see a new one in the toolbar. The name and the blue tile don't change.
- A change to the mark is a change to `icon.mjs`, followed by `npm run icons` and `npm run store:images -w @xomoni/extension`. The tests say which copy is stale.
- Each new platform Xomoni works on (email first) appears in words, or under a generic icon, never under its own logo.

## Alternatives considered

Four concepts were drawn with the same code and compared at 16, 32, 48 and 128 pixels on light and dark toolbars ([sheet](../brand/icon-concepts.png)):

- **Steps**, two shoe prints, the older one fading: chosen. It says "footprint" without words. It shows two shapes even at 16 pixels, and leaning at 24° keeps the prints from reading as exclamation marks.
- **Trail**, dots on an arc growing toward the front: the clearest at 16 pixels. But it reads as a loading spinner or bubbles, and says nothing about footprints without the name.
- **Walk**, three alternating ovals fading: the simplest. But it reads as beans or eggs until 48 pixels, and as noise at 16.
- **Shield and trail**, a white shield with a fading dotted path: clear, but every privacy and security extension has a shield, and it promises protection Xomoni doesn't offer.
- **Keeping the old icon**, or a lowercase "x": refused. Either stays close to X's mark, and no letter X can be shown to be clearly not X's.
