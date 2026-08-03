import { Env } from './types';

/**
 * Pipeline compartido de las páginas SEO server-rendered (/incendios/*): toma
 * el index.html del propio deploy (binding ASSETS: los bundles con hash vienen
 * ya inyectados por Vite) y lo transforma con HTMLRewriter — title,
 * description, canonical, OG/Twitter, H1, párrafo, bloque de enlaces y JSON-LD
 * opcional. React sustituye el contenido de #root al montar: el HTML único
 * existe para el crawler; el usuario ve el mapa.
 */

export const CANONICAL_HOST = 'radarincendios.com';

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const BASE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  // must-revalidate: HTML cacheado tras un deploy referenciaría bundles con
  // hash ya inexistentes (mismo perfil que el index estático).
  'Cache-Control': 'public, max-age=0, must-revalidate',
  // _headers solo aplica a estáticos: paridad manual con su bloque /*.
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export interface SeoPageContent {
  /** URL absoluta canónica de la página. */
  canonical: string;
  title: string;
  description: string;
  h1: string;
  /** Sustituye el primer <p> de #root (el párrafo introductorio de la home). */
  intro: string;
  /** Bloque <nav> ya renderizado; se inserta antes del cierre de #root > div. */
  navHtml: string;
  /** <script type="application/ld+json">…</script> ya serializado → <head>. */
  jsonLdHtml?: string;
}

export function renderSeoPage(assetRes: Response, content: SeoPageContent): Response {
  let firstP = true;
  const setContent = (value: string) => ({
    element: (e: Element) => {
      e.setAttribute('content', value);
    },
  });
  const rewritten = new HTMLRewriter()
    .on('title', {
      element: (e) => {
        e.setInnerContent(content.title);
      },
    })
    .on('meta[name="description"]', setContent(content.description))
    .on('link[rel="canonical"]', {
      element: (e) => {
        e.setAttribute('href', content.canonical);
      },
    })
    .on('meta[property="og:title"]', setContent(content.title))
    .on('meta[property="og:description"]', setContent(content.description))
    .on('meta[property="og:url"]', setContent(content.canonical))
    .on('meta[name="twitter:title"]', setContent(content.title))
    .on('meta[name="twitter:description"]', setContent(content.description))
    // El marcado VideoObject describe los vídeos de presentación del mapa y
    // vive solo en la home: repetirlo idéntico en miles de páginas por
    // localidad no aporta nada y diluye a qué URL asocia Google el vídeo.
    .on('#ld-video', {
      element: (e) => {
        e.remove();
      },
    })
    .on('head', {
      element: (e) => {
        if (content.jsonLdHtml) e.append(content.jsonLdHtml, { html: true });
      },
    })
    .on('#root h1', {
      element: (e) => {
        e.setInnerContent(content.h1);
      },
    })
    .on('#root p', {
      element: (e) => {
        if (firstP) {
          firstP = false;
          e.setInnerContent(content.intro);
        }
      },
    })
    // append inserta antes del cierre del wrapper: los enlaces quedan tras el
    // "Cargando el mapa…" y React los sustituye igual al montar.
    .on('#root > div', {
      element: (e) => {
        e.append(content.navHtml, { html: true });
      },
    })
    .transform(assetRes);

  return new Response(rewritten.body, { status: 200, headers: BASE_HEADERS });
}

/** JSON-LD BreadcrumbList serializado como <script>. El último ítem va sin
 *  `item`: Google lo asume como la URL actual. */
export function breadcrumbLd(items: Array<{ name: string; item?: string }>): string {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      ...(it.item ? { item: it.item } : {}),
    })),
  };
  // <: que un nombre con "<" jamás pueda cerrar el <script>.
  const json = JSON.stringify(ld).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

/** 404 con la SPA + noindex: el crawler entiende el error y un humano con un
 *  enlace roto aterriza igualmente en el mapa. */
export async function notFoundPage(ctx: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const assetRes = await ctx.env.ASSETS.fetch('https://assets.internal/');
  if (!assetRes.ok) return new Response('Not found', { status: 404 });
  const body = new HTMLRewriter()
    .on('meta[name="robots"]', {
      element: (e) => {
        e.setAttribute('content', 'noindex');
      },
    })
    .transform(assetRes).body;
  return new Response(body, {
    status: 404,
    headers: { ...BASE_HEADERS, 'Cache-Control': 'no-store' },
  });
}
