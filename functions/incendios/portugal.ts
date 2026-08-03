import { loadPages, MuniPage, PageIndex } from '../_lib/muni-pages';
import { PORTUGAL_SLUG, PT_DISTRICTS } from '../_lib/portugal';
import { breadcrumbLd, CANONICAL_HOST, esc, renderSeoPage } from '../_lib/seo-page';
import { Env } from '../_lib/types';

/**
 * Landing de país /incendios/portugal: hub SEO del cluster «mapa incendios
 * portugal (hoy)» — búsquedas en español hechas desde España que hasta ahora
 * absorbía la home. Ruta estática: gana a [slug].ts por precedencia
 * (estática > dinámica); las variantes no canónicas (/incendios/Portugal,
 * barra final) siguen cayendo en [slug].ts, que redirige aquí con 301.
 *
 * El interlinking baja a los 18 concelhos capital de distrito, derivados de
 * muni-meta con la regla «concelho cuyo nombre == nombre del distrito» (los
 * slugs no son siempre el nombre a secas: porto-porto, vila-real-vila-real).
 */

function districtCapitals(pages: PageIndex): MuniPage[] {
  const capitals: MuniPage[] = [];
  for (const siblings of pages.byRegion) {
    const region = siblings[0]?.region;
    if (!region || !PT_DISTRICTS.has(region)) continue;
    const capital = siblings.find((m) => m.name === region);
    if (capital) capitals.push(capital); // si un distrito no la tuviera, se omite
  }
  return capitals.sort((a, b) => a.region.localeCompare(b.region, 'es'));
}

function renderDistrictNav(capitals: MuniPage[]): string {
  const items = capitals
    .map(
      (m) =>
        `<li><a href="/incendios/${m.slug}" style="color:#e2e8f0">Incendios en ${esc(m.region)}</a></li>`
    )
    .join('');
  return (
    `<nav aria-label="Distritos de Portugal" style="max-width:42rem;color:#94a3b8;text-align:left">` +
    `<h2 style="font-size:1rem;margin:0 0 .5rem">Incendios en Portugal por distrito</h2>` +
    `<ul style="margin:0;padding-left:1.2rem;line-height:1.7">${items}</ul>` +
    `<p style="margin:.75rem 0 0"><a href="/" style="color:#e2e8f0">Mapa de incendios en España y Portugal</a></p>` +
    `</nav>`
  );
}

/** Exportada para la delegación defensiva desde [slug].ts (si la precedencia
 *  estática fallara, la landing se sirve igual y sin bucles de redirección). */
export async function renderPortugalPage(
  ctx: Parameters<PagesFunction<Env>>[0]
): Promise<Response> {
  // El routing estático de Pages captura también /incendios/Portugal y
  // /incendios/portugal/ (matching insensible a mayúsculas y barra final), de
  // modo que esas variantes no llegan a caer en [slug].ts: el 301 a la forma
  // canónica se emite aquí. Cuando [slug].ts delega, el pathname ya es el
  // canónico y esta guarda no dispara (sin bucles).
  const url = new URL(ctx.request.url);
  if (url.pathname !== `/incendios/${PORTUGAL_SLUG}`) {
    return Response.redirect(`${url.origin}/incendios/${PORTUGAL_SLUG}`, 301);
  }

  const pages = await loadPages(ctx.env);
  // Sin meta no hay nav de distritos fiable: mejor el fallback SPA que un 500.
  if (!pages) return ctx.next();

  const assetRes = await ctx.env.ASSETS.fetch('https://assets.internal/');
  if (!assetRes.ok) return ctx.next();

  const origin = `https://${CANONICAL_HOST}`;
  const canonical = `${origin}/incendios/${PORTUGAL_SLUG}`;
  const title = 'Mapa de incendios en Portugal hoy, en tiempo real · Radar de Incendios';
  const description =
    'Mapa de incendios en Portugal hoy: focos activos detectados por satélite NASA en las ' +
    'últimas 24 horas, área quemada de Copernicus y viento con la dirección del humo, ' +
    'por distritos y concelhos.';
  const h1 = 'Incendios en Portugal hoy, en tiempo real';
  const intro =
    'Consulta sobre el mapa los incendios activos en Portugal continental: focos de calor ' +
    'detectados por los satélites de la NASA en las últimas 24 horas, perímetros de área ' +
    'quemada de Copernicus EFFIS y viento en la zona, por distrito y concelho. ' +
    'Gratuito y sin registro.';

  return renderSeoPage(assetRes, {
    canonical,
    title,
    description,
    h1,
    intro,
    navHtml: renderDistrictNav(districtCapitals(pages)),
    jsonLdHtml: breadcrumbLd([{ name: 'Inicio', item: `${origin}/` }, { name: 'Portugal' }]),
  });
}

export const onRequestGet = renderPortugalPage;
// Los crawlers sondean a veces con HEAD: mismos status y headers que el GET
// (el runtime descarta el cuerpo).
export const onRequestHead = renderPortugalPage;
