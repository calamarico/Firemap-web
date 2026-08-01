import { fetchFwiClass } from '../_lib/fwi';
import { Env } from '../_lib/types';

/**
 * GET /api/fwi?lat=&lon= — clase de riesgo de incendio (FWI de EFFIS/GWIS)
 * en el punto, hoy. Respuesta: { fwi: { id, label, color, date } | null }.
 *
 * La usa la sidebar cuando hay localidad activa; las páginas de localidad
 * consultan la lib directamente en el server. La caché diaria por celda de
 * 0.1° vive en _lib/fwi.ts; aquí solo se añade la cabecera para el navegador.
 */
export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  // Cobertura del mapa (con margen): fuera de ella no hay nada que muestrear.
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 26 || lat > 46 || lon < -21 || lon > 8) {
    return Response.json({ error: { message: 'lat/lon fuera de rango' } }, { status: 400 });
  }
  const fwi = await fetchFwiClass(lat, lon);
  return Response.json(
    { fwi },
    {
      headers: {
        // Una hora en el navegador: el dato es diario, pero acortar la ventana
        // permite recuperarse pronto si GWIS estaba caído en la primera visita.
        'Cache-Control': 'public, max-age=3600',
      },
    }
  );
};
