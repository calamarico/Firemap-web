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

const CACHE_NAME = 'fm-effis-tiles-v1';
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
      const data = await res.arrayBuffer();
      if (cache) void store(cache, key, data, res.headers.get('content-type') ?? 'image/png');
      return { data };
    } catch (err) {
      if (abortController.signal.aborted) throw err;
      const cached = cache ? await readFresh(cache, key) : null;
      if (cached) return { data: cached };
      throw err;
    }
  });

  void pruneExpired();
}
