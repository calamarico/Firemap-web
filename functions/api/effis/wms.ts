import { fetchEffisTile, type EffisProduct } from '../../_lib/effis';
import { errorResponse } from '../../_lib/http';
import { Env } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const params = new URL(ctx.request.url).searchParams;
    // Sin ?layer= es el área quemada de siempre (compatible con embeds ya
    // desplegados); layer=danger sirve el riesgo de incendio (FWI), cuyo
    // parámetro temporal es ?day=0..8 en vez de ?range=.
    const product: EffisProduct = params.get('layer') === 'danger' ? 'danger' : 'ba';
    const tile = await fetchEffisTile(
      product === 'danger' ? (params.get('day') ?? '0') : (params.get('range') ?? '7d'),
      params.get('bbox') ?? '',
      params.get('width') ?? '256',
      params.get('height') ?? '256',
      (p) => ctx.waitUntil(p),
      product
    );
    return new Response(tile.body, {
      headers: {
        'Content-Type': tile.contentType,
        'Cache-Control': 'public, max-age=900',
      },
    });
  } catch (err) {
    // Fallo cacheado un minuto: con EFFIS caído, MapLibre volvería a pedir las
    // mismas teselas en cada paneo y cada intento es una invocación que ya
    // sabemos que va a fallar. La recuperación no queda bloqueada porque al
    // volver el servicio el cliente cambia la URL (&v=N) y salta esta cache.
    const res = errorResponse(err);
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'public, max-age=60');
    return new Response(res.body, { status: res.status, headers });
  }
};
