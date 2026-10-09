/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts'],
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
              },
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
        // One CommonJS build only: the window is sandboxed, and sandboxed preloads
        // cannot be ES modules. A second (lib) build used to race this one and
        // sometimes left an ESM preload.js behind, which broke the app.
        // vite-plugin-electron adds that ES-module "lib" build because package.json
        // is "type": "module"; `lib: false` turns it off so only this build runs.
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: false,
            rollupOptions: {
              input: 'electron/preload.ts',
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: 'preload.js',
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'framer-motion': ['framer-motion'],
          'radix-ui': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-select',
            '@radix-ui/react-switch',
            '@radix-ui/react-tooltip',
          ],
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
