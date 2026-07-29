import { loadMeta } from '../_lib/impact';
import { Env } from '../_lib/types';

/**
 * Páginas por localidad (/incendios/<slug>): SEO programático sin ficheros
 * estáticos por municipio. La Function toma el index.html del propio deploy
 * (binding ASSETS: los bundles con hash vienen ya inyectados por Vite) y lo
 * transforma con HTMLRewriter — title, description, canonical, OG/Twitter, H1,
 * párrafo y un bloque de enlaces a las localidades vecinas. React sustituye el
 * contenido de #root al montar, igual que en la home: el HTML único existe
 * para el crawler; el usuario ve el mapa volando a la localidad.
 *
 * Los slugs son el campo `s` de muni-meta.json (generados y desambiguados por
 * scripts/build-muni-index.mjs); el sitemap los publica (build-sitemap.mjs).
 * Solo existe en el despliegue Cloudflare: en Express, /incendios/* cae al
 * index genérico y el cliente resuelve el slug igualmente.
 */

const CANONICAL_HOST = 'firemapsspain.online';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NEIGHBOR_LINKS = 10;

interface MuniPage {
  name: string;
  region: string;
  regionIdx: number;
  center: [number, number];
  slug: string;
}

interface PageIndex {
  bySlug: Map<string, MuniPage>;
  byRegion: MuniPage[][];
}

// Memo por isolate sobre loadMeta (que ya memoiza el JSON): mapa slug→página
// y municipios agrupados por región para los enlaces a vecinos.
let pagesPromise: Promise<PageIndex | null> | null = null;

function loadPages(env: Env): Promise<PageIndex | null> {
  pagesPromise ??= loadMeta(env).then((meta) => {
    if (!meta) {
      pagesPromise = null; // permite reintentar en la siguiente petición
      return null;
    }
    const bySlug = new Map<string, MuniPage>();
    const byRegion: MuniPage[][] = meta.regions.map(() => []);
    for (const m of meta.municipalities) {
      const page: MuniPage = {
        name: m.n,
        region: meta.regions[m.r] ?? '',
        regionIdx: m.r,
        center: m.c,
        slug: m.s,
      };
      bySlug.set(m.s, page);
      byRegion[m.r]?.push(page);
    }
    return { bySlug, byRegion };
  });
  return pagesPromise;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const BASE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  // must-revalidate: HTML cacheado tras un deploy referenciaría bundles con
  // hash ya inexistentes (mismo perfil que el index estático).
  'Cache-Control': 'public, max-age=0, must-revalidate',
  // _headers solo aplica a estáticos: paridad manual con su bloque /*.
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

const handler: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const slug = String(ctx.params.slug ?? '').toLowerCase();
  if (!SLUG_RE.test(slug)) return notFound(ctx);

  const pages = await loadPages(ctx.env);
  // Sin meta no hay 404 fiable: mejor el fallback SPA genérico que un 500.
  if (!pages) return ctx.next();

  const page = pages.bySlug.get(slug);
  if (!page) return notFound(ctx);

  // Mayúsculas o trailing slash → 301 a la forma canónica. Mismo origen: el
  // middleware ya canonicaliza el host y los previews siguen navegables.
  if (url.pathname !== `/incendios/${slug}`) {
    return Response.redirect(`${url.origin}/incendios/${slug}`, 301);
  }

  const assetRes = await ctx.env.ASSETS.fetch('https://assets.internal/');
  if (!assetRes.ok) return ctx.next();

  const canonical = `https://${CANONICAL_HOST}/incendios/${slug}`;
  const title = `Incendios en ${page.name} (${page.region}) hoy · Firemaps`;
  const description =
    `Mapa de incendios en ${page.name} (${page.region}) hoy: focos activos detectados por ` +
    'satélite NASA en las últimas 24 horas, área quemada de Copernicus y viento con la dirección del humo.';
  const h1 = `Incendios en ${page.name} hoy, en tiempo real`;
  const [lon, lat] = page.center;
  const coord = `${Math.abs(lat).toFixed(2)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(2)}°${lon < 0 ? 'O' : 'E'}`;
  // Redacción neutra ES/PT: las regiones 19-36 son distritos portugueses.
  const intro =
    `Consulta sobre el mapa los incendios activos en ${page.name}, en ${page.region} (${coord}): ` +
    'focos de calor detectados por los satélites de la NASA en las últimas 24 horas, perímetros de ' +
    'área quemada de Copernicus EFFIS y viento en la zona. Gratuito y sin registro.';
  const neighborsHtml = renderNeighbors(page, pages.byRegion[page.regionIdx] ?? []);

  let firstP = true;
  const setContent = (value: string) => ({
    element: (e: Element) => {
      e.setAttribute('content', value);
    },
  });
  const rewritten = new HTMLRewriter()
    .on('title', {
      element: (e) => {
        e.setInnerContent(title);
      },
    })
    .on('meta[name="description"]', setContent(description))
    .on('link[rel="canonical"]', {
      element: (e) => {
        e.setAttribute('href', canonical);
      },
    })
    .on('meta[property="og:title"]', setContent(title))
    .on('meta[property="og:description"]', setContent(description))
    .on('meta[property="og:url"]', setContent(canonical))
    .on('meta[name="twitter:title"]', setContent(title))
    .on('meta[name="twitter:description"]', setContent(description))
    // El marcado VideoObject describe los vídeos de presentación del mapa y
    // vive solo en la home: repetirlo idéntico en miles de páginas por
    // localidad no aporta nada y diluye a qué URL asocia Google el vídeo.
    .on('#ld-video', {
      element: (e) => {
        e.remove();
      },
    })
    .on('#root h1', {
      element: (e) => {
        e.setInnerContent(h1);
      },
    })
    .on('#root p', {
      element: (e) => {
        if (firstP) {
          firstP = false;
          e.setInnerContent(intro);
        }
      },
    })
    // append inserta antes del cierre del wrapper: los enlaces quedan tras el
    // "Cargando el mapa…" y React los sustituye igual al montar.
    .on('#root > div', {
      element: (e) => {
        e.append(neighborsHtml, { html: true });
      },
    })
    .transform(assetRes);

  return new Response(rewritten.body, { status: 200, headers: BASE_HEADERS });
};

export const onRequestGet = handler;
// Los crawlers sondean a veces con HEAD: mismos status y headers que el GET
// (el runtime descarta el cuerpo).
export const onRequestHead = handler;

/** Los NEIGHBOR_LINKS municipios más cercanos de la misma región: bloque de
 *  interlinking distinto por página (y útil para quien navega sin JS). */
function renderNeighbors(page: MuniPage, siblings: MuniPage[]): string {
  const nearest = siblings
    .filter((m) => m.slug !== page.slug)
    .map((m) => ({
      m,
      d: (m.center[0] - page.center[0]) ** 2 + (m.center[1] - page.center[1]) ** 2,
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, NEIGHBOR_LINKS);
  const items = nearest
    .map(
      ({ m }) =>
        `<li><a href="/incendios/${m.slug}" style="color:#e2e8f0">Incendios en ${esc(m.name)}</a></li>`
    )
    .join('');
  return (
    `<nav aria-label="Localidades cercanas" style="max-width:42rem;color:#94a3b8;text-align:left">` +
    `<h2 style="font-size:1rem;margin:0 0 .5rem">Incendios cerca de ${esc(page.name)} (${esc(page.region)})</h2>` +
    `<ul style="margin:0;padding-left:1.2rem;line-height:1.7">${items}</ul>` +
    `<p style="margin:.75rem 0 0"><a href="/" style="color:#e2e8f0">Mapa de incendios en España y Portugal</a></p>` +
    `</nav>`
  );
}

/** 404 con la SPA + noindex: el crawler entiende el error y un humano con un
 *  enlace roto aterriza igualmente en el mapa. */
async function notFound(ctx: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
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
