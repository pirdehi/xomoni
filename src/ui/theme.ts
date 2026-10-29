export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'xomoni.theme';

export function getStoredTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

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

export function applyStoredTheme() {
  applyTheme(getStoredTheme());
}
