import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { adminSave } from './tools/vite-admin-save';

export default defineConfig({
  base: '/theMasonryArchive/',
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname,
    },
  },
  plugins: [react(), adminSave()],
});
