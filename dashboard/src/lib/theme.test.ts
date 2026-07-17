// @vitest-environment jsdom
/**
 * U5.1 — theme choice module. Dark is the app default; the choice is persisted and pinned as an
 * explicit `[data-theme]` on the root (so it beats the prefers-color-scheme media query).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readThemeChoice, persistThemeChoice, applyTheme, initTheme } from './theme';

function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  window.localStorage.clear();
});

describe('lib/theme', () => {
  it('defaults to dark when unset or unreadable', () => {
    expect(readThemeChoice(fakeStorage())).toBe('dark');
    expect(readThemeChoice(fakeStorage({ 'mc-theme': 'nonsense' }))).toBe('dark');
  });

  it('reads a persisted light choice', () => {
    expect(readThemeChoice(fakeStorage({ 'mc-theme': 'light' }))).toBe('light');
  });

  it('persists the choice under the mc-theme key', () => {
    const s = fakeStorage();
    persistThemeChoice('light', s);
    expect(s.getItem('mc-theme')).toBe('light');
  });

  it('applyTheme stamps an explicit data-theme attribute on the root', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('initTheme applies the persisted choice and returns it', () => {
    window.localStorage.setItem('mc-theme', 'light');
    expect(initTheme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
