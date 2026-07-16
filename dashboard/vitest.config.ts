import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts', 'src/**/*.test.{ts,tsx}', 'public/**/*.test.ts'],
    // node-pty is NOT a dependency yet (arrives in D3.1). No native addons under test here.
    // `public/**/*.test.ts` covers the PWA manifest validity test (D0.10); the manifest and the
    // hand-rolled service worker live under public/ so Vite copies them verbatim into dist/.
  },
});
