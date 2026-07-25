import { getFires } from '../_lib/firms';
import { errorResponse, json } from '../_lib/http';
import { Env } from '../_lib/types';

/**
 * Keep-warm para un cron externo (cron-job.org, cada ~4 min): ejecuta el mismo
 * getFires que /api/fires —calienta la cache de módulo y la Cache API del
 * datacenter— pero responde solo un resumen, porque cron-job.org rechaza
 * cuerpos de respuesta grandes. Conviene que el cron salga de Europa para
 * calentar el mismo datacenter que usan los usuarios (la Cache API es local a
 * cada colo).
 */
export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const data = await getFires(ctx.env, (p) => ctx.waitUntil(p));
    return json(
      {
        ok: true,
        count: data.count,
        cached: data.cached,
        partial: data.partial,
        fetchedAt: data.fetchedAt,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return errorResponse(err);
  }
};
