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
        // Marcador de generación (g2, g3...): subirlo rota la URL de TODOS
        // los bundles a la vez. Existe porque el 2026-07-24 un deploy dejó
        // cacheado en edge y navegadores un HTML servido como JS con
        // "immutable, 1 año" (pantalla azul): al cambiar la URL, esas cachés
        // envenenadas dejan de consultarse sin pedirle nada al visitante.
        entryFileNames: 'assets/[name]-g2-[hash].js',
        chunkFileNames: 'assets/[name]-g2-[hash].js',
        assetFileNames: 'assets/[name]-g2-[hash][extname]',
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
