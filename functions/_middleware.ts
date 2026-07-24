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
  return ctx.next();
};
