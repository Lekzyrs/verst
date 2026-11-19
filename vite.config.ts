import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['iife'],
      name: 'Verst',
      fileName: () => 'verst.js',
    },
    target: 'es2020',
    sourcemap: true,
  },
});
