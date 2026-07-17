/**
 * U5.1 — theme choice (dark default, light on demand). Daniel's review round 1: dark is the app
 * default regardless of the OS preference, with a small persisted toggle. We therefore ALWAYS pin an
 * explicit `[data-theme]` on the document root — that attribute wins over the `prefers-color-scheme`
 * media query in app.css, so an OS-light machine still boots dark until the operator chooses light.
 *
 * Pure browser module (no node: builtins — see clientImportGraph.test.ts). `localStorage`/`document`
 * access is defensively wrapped so a private-mode/SSR-less environment can never throw on boot.
 */
export type ThemeChoice = 'dark' | 'light';

const STORAGE_KEY = 'mc-theme';

/** The persisted choice, defaulting to dark (the app default) when unset or unreadable. */
export function readThemeChoice(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): ThemeChoice {
  try {
    return storage?.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Persist the choice; a failure (private mode / disabled storage) is swallowed. */
export function persistThemeChoice(
  theme: ThemeChoice,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore — theme is a preference, never load-bearing */
  }
}

/** Stamp the explicit theme attribute on the root so it beats the OS media query. */
export function applyTheme(theme: ThemeChoice, root: HTMLElement | undefined = safeRoot()): void {
  if (root) root.dataset.theme = theme;
}

/** Read + apply the persisted choice in one call (used at boot, before first paint). */
export function initTheme(): ThemeChoice {
  const theme = readThemeChoice();
  applyTheme(theme);
  return theme;
}

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

function safeRoot(): HTMLElement | undefined {
  return typeof document === 'undefined' ? undefined : document.documentElement;
}
