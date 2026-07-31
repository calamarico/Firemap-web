import { loadPages, MuniPage } from '../_lib/muni-pages';
import { PORTUGAL_SLUG, PT_DISTRICTS } from '../_lib/portugal';
import { breadcrumbLd, CANONICAL_HOST, esc, notFoundPage, renderSeoPage } from '../_lib/seo-page';
import { Env } from '../_lib/types';
import { renderPortugalPage } from './portugal';

/**
 * Páginas por localidad (/incendios/<slug>): SEO programático sin ficheros
 * estáticos por municipio. El pipeline HTMLRewriter vive en _lib/seo-page.ts
 * (compartido con la landing de país); aquí queda la resolución del slug y la
 * composición del contenido. React sustituye el contenido de #root al montar,
 * igual que en la home: el HTML único existe para el crawler; el usuario ve
 * el mapa volando a la localidad.
 *
 * Los slugs son el campo `s` de muni-meta.json (generados y desambiguados por
 * scripts/build-muni-index.mjs); el sitemap los publica (build-sitemap.mjs).
 * Solo existe en el despliegue Cloudflare: en Express, /incendios/* cae al
 * index genérico y el cliente resuelve el slug igualmente.
 */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NEIGHBOR_LINKS = 10;

const handler: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const slug = String(ctx.params.slug ?? '').toLowerCase();
  if (!SLUG_RE.test(slug)) return notFoundPage(ctx);

  // Slug reservado de la landing de país: la forma canónica exacta la sirve la
  // ruta estática incendios/portugal.ts (precedencia estática > dinámica), así
  // que aquí solo llegan variantes (mayúsculas, barra final) → 301. Si la
  // precedencia fallara y llegara la forma canónica, se delega sin bucle.
  if (slug === PORTUGAL_SLUG) {
    if (url.pathname === `/incendios/${PORTUGAL_SLUG}`) return renderPortugalPage(ctx);
    return Response.redirect(`${url.origin}/incendios/${PORTUGAL_SLUG}`, 301);
  }

  const pages = await loadPages(ctx.env);
  // Sin meta no hay 404 fiable: mejor el fallback SPA genérico que un 500.
  if (!pages) return ctx.next();

  const page = pages.bySlug.get(slug);
  if (!page) return notFoundPage(ctx);

  // Mayúsculas o trailing slash → 301 a la forma canónica. Mismo origen: el
  // middleware ya canonicaliza el host y los previews siguen navegables.
  if (url.pathname !== `/incendios/${slug}`) {
    return Response.redirect(`${url.origin}/incendios/${slug}`, 301);
  }

  const assetRes = await ctx.env.ASSETS.fetch('https://assets.internal/');
  if (!assetRes.ok) return ctx.next();

  const origin = `https://${CANONICAL_HOST}`;
  const canonical = `${origin}/incendios/${slug}`;
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

  // Miga de pan: los concelhos cuelgan de la landing /incendios/portugal; los
  // municipios españoles, directamente de la home (no hay páginas de CCAA).
  const isPt = PT_DISTRICTS.has(page.region);
  const crumbs = isPt
    ? [
        { name: 'Inicio', item: `${origin}/` },
        { name: 'Portugal', item: `${origin}/incendios/${PORTUGAL_SLUG}` },
        { name: page.name },
      ]
    : [{ name: 'Inicio', item: `${origin}/` }, { name: page.name }];

  return renderSeoPage(assetRes, {
    canonical,
    title,
    description,
    h1,
    intro,
    navHtml: renderNeighbors(page, pages.byRegion[page.regionIdx] ?? [], isPt),
    jsonLdHtml: breadcrumbLd(crumbs),
  });
};

export const onRequestGet = handler;
// Los crawlers sondean a veces con HEAD: mismos status y headers que el GET
// (el runtime descarta el cuerpo).
export const onRequestHead = handler;

/** Los NEIGHBOR_LINKS municipios más cercanos de la misma región: bloque de
 *  interlinking distinto por página (y útil para quien navega sin JS). */
function renderNeighbors(page: MuniPage, siblings: MuniPage[], isPt: boolean): string {
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
  const ptLink = isPt
    ? `<p style="margin:.75rem 0 0"><a href="/incendios/${PORTUGAL_SLUG}" style="color:#e2e8f0">Incendios en Portugal</a></p>`
    : '';
  return (
    `<nav aria-label="Localidades cercanas" style="max-width:42rem;color:#94a3b8;text-align:left">` +
    `<h2 style="font-size:1rem;margin:0 0 .5rem">Incendios cerca de ${esc(page.name)} (${esc(page.region)})</h2>` +
    `<ul style="margin:0;padding-left:1.2rem;line-height:1.7">${items}</ul>` +
    ptLink +
    `<p style="margin:.75rem 0 0"><a href="/" style="color:#e2e8f0">Mapa de incendios en España y Portugal</a></p>` +
    `</nav>`
  );
}
