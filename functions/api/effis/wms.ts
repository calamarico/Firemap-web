import { fetchEffisTile } from '../../_lib/effis';
import { errorResponse } from '../../_lib/http';
import { Env } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const params = new URL(ctx.request.url).searchParams;
    const tile = await fetchEffisTile(
      params.get('range') ?? '7d',
      params.get('bbox') ?? '',
      params.get('width') ?? '256',
      params.get('height') ?? '256',
      (p) => ctx.waitUntil(p)
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
