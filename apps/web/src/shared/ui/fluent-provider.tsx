'use client';
// Fluent UI on xomoni.com (ADR-0019): Xomoni's shared themes, with Griffel's styles rendered on the server so pages
// arrive styled. The dark theme's variables sit under `prefers-color-scheme: dark` in the page itself, so a dark
// system sees dark from the first paint; the provider then follows the system as it changes.
import {
  FluentProvider,
  RendererProvider,
  SSRProvider,
  createDOMRenderer,
  renderToStyleElements,
} from '@fluentui/react-components';
import { themeVariables, xomoniDarkTheme, xomoniLightTheme } from '@xomoni/fluent-theme';
import { useServerInsertedHTML } from 'next/navigation';
import { type ReactNode, useRef, useState, useSyncExternalStore } from 'react';

/** The site's font, loaded by `next/font` in the root layout, ahead of Xomoni's system font stack. */
const SITE_FONT = "var(--font-geist-sans), system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/** Xomoni's light theme on the site's font. */
export const siteLight = xomoniLightTheme(SITE_FONT);

/** Xomoni's dark theme on the site's font. */
export const siteDark = xomoniDarkTheme(SITE_FONT);

/** The class on the provider's element that the dark-mode variables target. */
const ROOT_CLASS = 'xomoni-theme';

/**
 * The dark theme's variables for a dark system, written into the page. Doubled class: it outranks the light
 * variables Fluent's provider sets on the same element.
 */
export const DARK_MEDIA_CSS = `@media (prefers-color-scheme: dark) { .${ROOT_CLASS}.${ROOT_CLASS} { ${themeVariables(siteDark)} } }`;

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Whether the system is in dark mode, following its changes; `false` while rendering on the server. */
export function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(DARK_QUERY);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
}

/**
 * Wraps the site in Fluent's provider. On the server it collects Griffel's styles and inserts them into the page
 * (`useServerInsertedHTML`), so nothing flashes unstyled; the provider's element takes no part in the layout
 * (`display: contents`).
 */
export function SiteFluentProvider({ children }: { children: ReactNode }) {
  const [renderer] = useState(() => createDOMRenderer());
  const inserted = useRef(false);
  const dark = usePrefersDark();
  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;
    return <>{renderToStyleElements(renderer)}</>;
  });
  return (
    <RendererProvider renderer={renderer}>
      <SSRProvider>
        <style>{DARK_MEDIA_CSS}</style>
        <FluentProvider
          theme={dark ? siteDark : siteLight}
          className={ROOT_CLASS}
          style={{ display: 'contents', backgroundColor: 'transparent' }}
        >
          {children}
        </FluentProvider>
      </SSRProvider>
    </RendererProvider>
  );
}
