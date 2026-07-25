import maplibregl from 'maplibre-gl';

/**
 * Persistencia local de las teselas de área quemada (EFFIS). El área quemada
 * llega como raster WMS, no como vectores, así que lo que se guarda son las
 * propias teselas en la Cache API del navegador (pensada para respuestas
 * binarias; localStorage solo admite cadenas y ~5 MB). El protocolo
 * effis-tiles:// intercepta cada petición de tesela:
 *
 * - Servicio vivo: red, y la respuesta se guarda como copia local.
 * - Petición fallida: se sirve la copia local si tiene menos de 24 h.
 * - Servicio confirmado caído (setEffisDown): solo copia local, sin tocar la
 *   red — cada GetMap sería una invocación del Worker condenada a fallar.
 *
 * Así, aunque EFFIS se caiga, el visitante sigue viendo los perímetros que su
 * navegador ya descargó, hasta que el servicio vuelva y los reemplace.
 */

export const EFFIS_TILE_PROTOCOL = 'effis-tiles';

// v2: la v1 se llenó sin la validación de píxeles y pudo quedar envenenada
// con placas opacas del modo degradado de EFFIS.
const CACHE_NAME = 'fm-effis-tiles-v2';
/** La Cache API no guarda TTL: el instante de descarga va en un header propio. */
const FETCHED_AT_HEADER = 'x-fm-fetched-at';
/** Caducidad de la copia local; debe coincidir con el aviso del Sidebar. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// PNG transparente de 1×1: la respuesta cuando no hay ni red ni copia local.
// Devolver un error haría que MapLibre registrase un fallo por cada tesela
// mientras dure la caída.
const TRANSPARENT_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0)
).buffer;

let effisDown = false;

/** App lo sincroniza con /api/effis/status: true = confirmado caído. */
export function setEffisDown(down: boolean): void {
  effisDown = down;
}

/** null si la Cache API no está disponible (contexto no seguro, modo privado…). */
async function openTileCache(): Promise<Cache | null> {
  if (!('caches' in window)) return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

/**
 * La clave ignora el parámetro v= (época de recarga tras una caída): el mismo
 * bbox siempre actualiza su copia en lugar de acumular duplicados.
 */
function cacheKeyFor(url: string): string {
  const u = new URL(url);
  u.searchParams.delete('v');
  return u.toString();
}

async function readFresh(cache: Cache, key: string): Promise<ArrayBuffer | null> {
  const hit = await cache.match(key);
  if (!hit) return null;
  const fetchedAt = Number(hit.headers.get(FETCHED_AT_HEADER));
  if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > MAX_AGE_MS) {
    void cache.delete(key);
    return null;
  }
  return hit.arrayBuffer();
}

async function store(cache: Cache, key: string, data: ArrayBuffer, contentType: string) {
  try {
    await cache.put(
      key,
      new Response(data, {
        headers: { 'content-type': contentType, [FETCHED_AT_HEADER]: String(Date.now()) },
      })
    );
  } catch {
    // Cuota de almacenamiento llena o similar: la tesela ya se devolvió al
    // mapa, solo se pierde la copia local.
  }
}

/**
 * Última defensa contra el modo degradado de EFFIS: teselas 200 con canal
 * alfa válido pero con TODOS los píxeles opacos (placas negras o blancas que
 * tapan el mapa). El proxy ya corta las estructuralmente opacas (sin alfa ni
 * tRNS), pero el contenido de los píxeles solo puede verlo quien decodifica
 * la imagen: el navegador. Una tesela legítima es mayormente transparente; y
 * si un día una estuviera cubierta al 100% por área quemada, su marrón queda
 * lejos de los dos umbrales de luminancia.
 */
export async function isPoisonedTile(data: ArrayBuffer, contentType: string): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(new Blob([data], { type: contentType }));
    const side = 16; // muestreo reducido: 256 píxeles bastan para ver una placa
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(bitmap, 0, 0, side, side);
    bitmap.close();

    const px = ctx.getImageData(0, 0, side, side).data;
    let opaque = 0;
    let luminance = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] > 200) opaque += 1;
      luminance += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    }
    const total = px.length / 4;
    return opaque / total > 0.95 && (luminance / total < 32 || luminance / total > 224);
  } catch {
    return true; // ni siquiera decodifica como imagen: tampoco sirve de tesela
  }
}

/** Las copias caducadas solo se detectan al leerlas: barrido al arrancar. */
async function pruneExpired(): Promise<void> {
  const cache = await openTileCache();
  if (!cache) return;
  for (const request of await cache.keys()) {
    const hit = await cache.match(request);
    const fetchedAt = Number(hit?.headers.get(FETCHED_AT_HEADER));
    if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > MAX_AGE_MS) {
      void cache.delete(request);
    }
  }
}

export function registerEffisTileProtocol(): void {
  maplibregl.addProtocol(EFFIS_TILE_PROTOCOL, async (params, abortController) => {
    const url = params.url.slice(`${EFFIS_TILE_PROTOCOL}://`.length);
    const cache = await openTileCache();
    const key = cache ? cacheKeyFor(url) : '';

    if (effisDown) {
      const cached = cache ? await readFresh(cache, key) : null;
      return { data: cached ?? TRANSPARENT_PNG };
    }

    try {
      const res = await fetch(url, { signal: abortController.signal });
      if (!res.ok) throw new Error(`El WMS de EFFIS devolvió HTTP ${res.status}.`);
      const contentType = res.headers.get('content-type') ?? 'image/png';
      const data = await res.arrayBuffer();
      if (await isPoisonedTile(data, contentType)) {
        // Placa opaca del modo degradado: ni se pinta ni se guarda. Mejor la
        // última copia buena (o nada) que oscurecer el mapa.
        const cached = cache ? await readFresh(cache, key) : null;
        return { data: cached ?? TRANSPARENT_PNG };
      }
      if (cache) void store(cache, key, data, contentType);
      return { data };
    } catch (err) {
      if (abortController.signal.aborted) throw err;
      const cached = cache ? await readFresh(cache, key) : null;
      // Sin copia local: tesela transparente en vez de error. Relanzar solo
      // llenaría la consola (un error por tesela durante toda la caída) y no
      // cambia el reintento, que ya lo gobierna la recarga por época al
      // recuperarse el servicio.
      return { data: cached ?? TRANSPARENT_PNG };
    }
  });

  void pruneExpired();
  // La cache de la versión anterior se retira: sin validación de píxeles
  // pudo quedar envenenada con placas opacas.
  if ('caches' in window) {
    caches.delete('fm-effis-tiles-v1').catch(() => {});
  }
}
