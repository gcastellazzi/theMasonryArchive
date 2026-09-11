import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { adminSave } from './tools/vite-admin-save';

export default defineConfig({
  base: '/theMasonryArchive/',
  // Porta dedicata: la 5173 predefinita e' condivisa con altri progetti Vite
  // (Intake Assistant), e `localhost` finiva sull'app sbagliata. strictPort fa
  // fallire l'avvio se la porta e' occupata, invece di spostarsi in silenzio.
  server: { port: 5180, strictPort: true },
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname,
    },
  },
  plugins: [react(), adminSave()],
});
