/**
 * Host canónico para SEO: todo el tráfico que llegue por alias
 * (firemap-web.pages.dev, www.firemapsspain.online) se redirige con 301 al
 * dominio canónico, conservando ruta y query. Así los buscadores no reparten
 * la autoridad entre dominios duplicados.
 *
 * Los previews de ramas (<hash>.<proyecto>.pages.dev, 4 etiquetas) NO se
 * redirigen: siguen siendo útiles para probar antes de mergear.
 */
const CANONICAL_HOST = 'firemapsspain.online';

export const onRequest: PagesFunction = async (ctx) => {
  const url = new URL(ctx.request.url);
  const host = url.hostname;

  const isProductionAlias =
    host === `www.${CANONICAL_HOST}` ||
    (host.endsWith('.pages.dev') && host.split('.').length === 3);

  if (isProductionAlias) {
    url.hostname = CANONICAL_HOST;
    return Response.redirect(url.toString(), 301);
  }

  // Antiveneno de caché: si un bundle con hash no existe (p. ej. una petición
  // que cruza justo con un deploy), Pages responde el fallback SPA — HTML con
  // el Cache-Control "immutable, 1 año" que _headers asigna a /assets/*. El
  // edge de Cloudflare cachearía ese HTML como si fuera el JS durante un año
  // (pasó el 2026-07-24: pantalla azul persistente). Un 404 sin caché deja el
  // fallo en transitorio: el siguiente intento ya encuentra el fichero real.
  if (url.pathname.startsWith('/assets/')) {
    const res = await ctx.next();
    if ((res.headers.get('content-type') ?? '').startsWith('text/html')) {
      return new Response('Asset no encontrado en este deploy.', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    return res;
  }

  return ctx.next();
};
