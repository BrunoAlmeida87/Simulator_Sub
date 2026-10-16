import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base relativa: o build funciona em qualquer subcaminho (ex.: GitHub Pages /Simulator_Sub/)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
});
