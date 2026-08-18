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

/**
 * `--bg-base` as declared on the BARE `:root` in app.css — the dark default the shell paints before
 * any theme override. Read out of the stylesheet rather than restated here, so the manifest can never
 * quietly disagree with the palette: change the token and this test moves with it.
 */
const BG_BASE = (() => {
  const css = readFileSync(fileURLToPath(new URL('../src/styles/app.css', import.meta.url)), 'utf8');
  const match = /--bg-base:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(css);
  if (!match) throw new Error('app.css declares no --bg-base');
  return match[1];
})();

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
    // `--bg-base` from src/styles/app.css — the warm near-black the app shell actually paints.
    // (U12: these were pinned to a cold #0f1419 the palette no longer contains, so the installed
    // PWA's chrome and splash disagreed with the first painted frame. The value is read out of
    // app.css rather than restated, so the next palette change reds this test instead of drifting.)
    expect(manifest.theme_color).toBe(BG_BASE);
    expect(manifest.background_color).toBe(BG_BASE);
  });

  it('the index.html theme-color meta agrees with the manifest — one colour, two declarations', () => {
    const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
    const meta = /<meta\s+name="theme-color"\s+content="([^"]+)"/.exec(html);
    expect(meta, 'index.html declares a theme-color meta').not.toBeNull();
    expect(meta?.[1]).toBe(BG_BASE);
  });

  it('ships 192 and 512 png icons plus a maskable icon', () => {
    const bySize = (s: string): ManifestIcon | undefined =>
      manifest.icons.find((i) => i.sizes === s && i.type === 'image/png');
    expect(bySize('192x192')).toBeDefined();
    expect(bySize('512x512')).toBeDefined();
    expect(manifest.icons.some((i) => (i.purpose ?? '').includes('maskable'))).toBe(true);
  });
});
