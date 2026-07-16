/**
 * D0.10 — web app manifest validity. The manifest must describe an INSTALLABLE, standalone PWA
 * (Add-to-Home-Screen on iPhone over the ts.net origin) whose theme/background match the app.css
 * palette. Assertions are deliberately strict on the installability-critical fields.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}
interface WebManifest {
  name: string;
  short_name?: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
}

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('./manifest.webmanifest', import.meta.url)), 'utf8'),
) as WebManifest;

describe('manifest.webmanifest', () => {
  it('is standalone with a scoped start_url', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/');
    // start_url must live under scope (served-origin relative).
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
  });

  it('has a name for the home-screen label', () => {
    expect(manifest.name.length).toBeGreaterThan(0);
  });

  it('theme + background colors match the app.css palette', () => {
    // --bg from src/styles/app.css (dark, mission-control default).
    expect(manifest.theme_color).toBe('#0f1419');
    expect(manifest.background_color).toBe('#0f1419');
  });

  it('ships 192 and 512 png icons plus a maskable icon', () => {
    const bySize = (s: string): ManifestIcon | undefined =>
      manifest.icons.find((i) => i.sizes === s && i.type === 'image/png');
    expect(bySize('192x192')).toBeDefined();
    expect(bySize('512x512')).toBeDefined();
    expect(manifest.icons.some((i) => (i.purpose ?? '').includes('maskable'))).toBe(true);
  });
});
