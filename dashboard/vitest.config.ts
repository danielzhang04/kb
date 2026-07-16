import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    // node-pty is NOT a dependency yet (arrives in D3.1). No native addons under test here.
  },
});
