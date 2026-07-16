import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// The PWA manifest + service worker + icons live under public/ (D0.10) so Vite copies them verbatim
// into dist/. The manifest's colocated vitest spec (public/manifest.test.ts, per the plan) would be
// copied too — this plugin prunes stray *.test.* files from the built output so no test source is
// ever served from the production shell.
function prunePublicTestFiles(): Plugin {
  return {
    name: 'prune-public-test-files',
    apply: 'build',
    closeBundle() {
      const outDir = join(import.meta.dirname, 'dist');
      for (const entry of readdirSync(outDir, { withFileTypes: true })) {
        if (entry.isFile() && /\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
          rmSync(join(outDir, entry.name));
        }
      }
    },
  };
}

// Vite/React SPA. The React automatic JSX runtime is driven by tsconfig's
// `"jsx": "react-jsx"` (Vite's esbuild transform reads it), so no extra plugin
// dependency is needed — keeping the toolchain to the pinned dependency set. The dev
// server binds localhost and proxies /api + /events to the Fastify backend (D0.1).
export default defineConfig({
  root: '.',
  plugins: [prunePublicTestFiles()],
  server: {
    host: '127.0.0.1',
    port: 5317,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: false,
      },
      '/events': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: false,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
