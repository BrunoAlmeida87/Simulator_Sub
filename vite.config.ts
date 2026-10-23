import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// base relativa: o build funciona em qualquer subcaminho (ex.: GitHub Pages /Simulator_Sub/)
export default defineConfig({
  base: './',
  plugins: [
    react(),
    // leva o "Abrir-simulador.bat" para a versão pronta (dist e branch gh-pages): duplo clique abre o simulador no Windows
    {
      name: 'abrir-simulador-bat',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'Abrir-simulador.bat', source: readFileSync('Abrir-simulador.bat') });
      },
    },
  ],
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
