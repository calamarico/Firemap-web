import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // maplibre (~900 KB) y react en chunks propios: el código de la app
        // cambia en cada deploy, pero estos chunks conservan su hash y el
        // navegador los reutiliza de cache.
        manualChunks: {
          maplibre: ['maplibre-gl'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    // Todo /api va al proxy Express: el frontend nunca habla con FIRMS/EFFIS
    // directamente ni conoce el MAP_KEY.
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
