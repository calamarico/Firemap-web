import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';

/**
 * En dev, el fallback SPA de Vite serviría index.html para /embed y /insertar
 * (son documentos sin extensión). Este rewrite reproduce lo que hacen en
 * producción el html_handling de Cloudflare Pages y el `extensions: ['html']`
 * de Express, para que lo que se prueba en local sea lo que se despliega.
 */
const htmlPages = (): PluginOption => ({
  name: 'fm-html-pages',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const path = req.url?.split('?')[0];
      if (path === '/embed' || path === '/insertar') req.url = `${path}.html`;
      next();
    });
  },
});

/**
 * Los comentarios de los HTML son documentación INTERNA (decisiones SEO, notas
 * de mantenimiento) y solo deben vivir en el repo: servirlos expondría la
 * estrategia en el "ver código fuente" de cualquiera y suma bytes a cada una
 * de las ~8.500 páginas (el index es la plantilla de todas). Se retiran en
 * build; en dev se conservan (ahí ayudan). 404.html no pasa por
 * transformIndexHtml (vive en public/ y se copia verbatim): se limpia en
 * closeBundle sobre dist.
 */
const stripHtmlComments = (): PluginOption => ({
  name: 'fm-strip-html-comments',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (html) => html.replace(/<!--[\s\S]*?-->\n?/g, ''),
  },
  closeBundle() {
    const notFound = resolve(__dirname, 'dist/404.html');
    try {
      writeFileSync(notFound, readFileSync(notFound, 'utf8').replace(/<!--[\s\S]*?-->\n?/g, ''));
    } catch {
      // sin 404.html en el bundle (p. ej. build parcial): nada que limpiar
    }
    // robots.txt: mismas razones — sus comentarios # (p. ej. por qué /embed no
    // se bloquea) documentan estrategia y solo deben vivir en el repo.
    const robots = resolve(__dirname, 'dist/robots.txt');
    try {
      writeFileSync(
        robots,
        readFileSync(robots, 'utf8')
          .split('\n')
          .filter((line) => !line.startsWith('#'))
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
      );
    } catch {
      // ídem
    }
  },
});

export default defineConfig({
  plugins: [react(), htmlPages(), stripHtmlComments()],
  build: {
    rollupOptions: {
      // Tres documentos, tres entradas: la app (index.html), el widget
      // embebible (/embed) y el generador del código de inserción (/insertar).
      // Separarlos no es cosmético: el iframe de un artículo ajeno no descarga
      // la sidebar ni la prosa SEO de la home, y /insertar no descarga MapLibre
      // (su previsualización es un iframe a /embed). Cloudflare Pages sirve
      // embed.html en /embed y insertar.html en /insertar (html_handling);
      // Express hace lo propio con `extensions: ['html']`.
      input: {
        main: resolve(__dirname, 'index.html'),
        embed: resolve(__dirname, 'embed.html'),
        insertar: resolve(__dirname, 'insertar.html'),
      },
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
