import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: 'ui',
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
  },
  build: {
    outDir: '../build/ui',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './ui'),
    },
  },
});
