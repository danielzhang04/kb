import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'server/**/*.test.ts',
      'src/**/*.test.{ts,tsx}',
      'public/**/*.test.ts',
      // D3.3 — the Broker daemon lives in the sibling top-level `broker/` dir but JOINS this workspace
      // (no root package.json exists, so `npm test -- broker` is run from here). Its tests import a
      // couple of clean dashboard modules by relative path; running them under this one vitest keeps
      // the toolchain single-source and lets `npm test -- broker` filter to just the Broker suite.
      '../broker/**/*.test.ts',
    ],
    // node-pty is NOT a dependency yet (arrives in D3.1). No native addons under test here.
    // `public/**/*.test.ts` covers the PWA manifest validity test (D0.10); the manifest and the
    // hand-rolled service worker live under public/ so Vite copies them verbatim into dist/.
  },
});
