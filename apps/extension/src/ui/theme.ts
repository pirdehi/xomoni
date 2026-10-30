/** The dashboard color theme; `system` follows the operating system setting. */
export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'xomoni.theme';

/** The saved theme from `localStorage`; `system` when nothing is saved or storage is unavailable. */
export function getStoredTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Saves the choice and applies it at once through the `data-theme` attribute on `<html>` (removed for `system`). */
export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* storage unavailable; the choice still applies to this page */
  }
  applyTheme(choice);
}

function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
}

/** Applies the saved theme. `main.tsx` calls it before the first render, so the page does not flash in the wrong theme. */
export function applyStoredTheme() {
  applyTheme(getStoredTheme());
}
