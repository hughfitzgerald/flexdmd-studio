import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built app can be opened from any static host or sub-path.
  base: './',
  server: { port: 5173 },
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
