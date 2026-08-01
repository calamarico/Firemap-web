import { getIncidents } from '../_lib/incidents';
import { Env } from '../_lib/types';

/**
 * GET /api/incidents — estado operativo oficial de incendios donde hay fuente
 * estructurada (Bombers Catalunya, JCyL, Copernicus EMS). El agregado y su
 * caché viven en _lib/incidents.ts.
 */
export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const body = await getIncidents((p) => ctx.waitUntil(p));
  return Response.json(body, {
    // El navegador puede reusarla 5 min; el agregador ya cachea 10 min y las
    // fuentes más rápidas (Bombers) publican cada ~10 min.
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
};
