import { defineConfig } from 'vite';

// Vite/React SPA. The React automatic JSX runtime is driven by tsconfig's
// `"jsx": "react-jsx"` (Vite's esbuild transform reads it), so no extra plugin
// dependency is needed — keeping the toolchain to the pinned dependency set. The dev
// server binds localhost and proxies /api + /events to the Fastify backend (D0.1).
export default defineConfig({
  root: '.',
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
