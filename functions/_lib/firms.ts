import { isInSpain } from './geo';
import { computeImpact, loadIndex } from './impact';
import { ApiError, Env, FireHotspot, FiresResponse } from './types';

/**
 * Port a Workers de server/src/firms.ts, con dos adaptaciones:
 * - CSV parseado a mano (sin papaparse): el CSV de FIRMS no lleva comas
 *   embebidas y el parser propio gasta una fracción del CPU — importa con el
 *   límite de 10 ms/invocación del free plan.
 * - Cache en dos niveles: variable de módulo (válida mientras el isolate viva)
 *   + Cache API de Cloudflare para calentar isolates fríos sin ir a FIRMS.
 */

const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

const AREAS = [
  { name: 'peninsula-baleares', bbox: '-9.50,35.10,4.40,43.95' },
  { name: 'canarias', bbox: '-18.40,27.40,-13.30,29.50' },
] as const;

const MERGED_SENSORS = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'] as const;
const WINDOW_HOURS = 24;
const FETCH_DAYS = 2;

const FRESH_MS = 5 * 60 * 1000;
const STALE_MAX_MS = 30 * 60 * 1000;
// Clave sintética para la Cache API (el host es irrelevante: es un espacio de
// nombres). Versionada: al cambiar el contrato (p. ej. bbox en el ranking) se
// sube la versión y las entradas viejas quedan huérfanas.
const CACHE_KEY = 'https://firemap.cache/api/fires-v3';

let cacheEntry: { response: FiresResponse; at: number } | null = null;
let inFlight: Promise<FiresResponse> | null = null;

export async function getFires(env: Env, waitUntil: (p: Promise<unknown>) => void): Promise<FiresResponse> {
  const mapKey = env.FIRMS_MAP_KEY;
  if (!mapKey) {
    throw new ApiError(
      503,
      'NO_MAP_KEY',
      'Falta FIRMS_MAP_KEY. En Cloudflare Pages: Settings → Environment variables. ' +
        'En local: fichero .dev.vars. Clave gratuita en https://firms.modaps.eosdis.nasa.gov/api/map_key/'
    );
  }

  // Isolate frío: intenta calentar la cache de módulo desde la Cache API antes
  // de pagar el fan-out a FIRMS.
  if (!cacheEntry) await warmFromCacheApi();

  const now = Date.now();
  if (cacheEntry && now - cacheEntry.at < FRESH_MS && !cacheEntry.response.partial) {
    return { ...cacheEntry.response, cached: true };
  }

  if (!inFlight) {
    inFlight = refreshFires(mapKey, env)
      .then((response) => {
        if (!response.partial || !cacheEntry || cacheEntry.response.partial) {
          cacheEntry = { response, at: Date.now() };
          waitUntil(saveToCacheApi(response));
        }
        return response;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  if (cacheEntry && now - cacheEntry.at < STALE_MAX_MS) {
    // stale-while-revalidate: responde ya y deja la renovación de fondo viva
    // (waitUntil evita que el runtime la mate al despachar la respuesta).
    const pending = inFlight;
    waitUntil(pending.catch(() => {}));
    return { ...cacheEntry.response, cached: true };
  }

  return inFlight;
}

async function warmFromCacheApi(): Promise<void> {
  try {
    const hit = await caches.default.match(CACHE_KEY);
    if (!hit) return;
    const response = (await hit.json()) as FiresResponse;
    const at = Date.parse(response.fetchedAt);
    if (Number.isFinite(at)) cacheEntry = { response, at };
  } catch {
    // la Cache API es mejor-esfuerzo: sin ella simplemente se va a FIRMS
  }
}

async function saveToCacheApi(response: FiresResponse): Promise<void> {
  try {
    // El TTL real lo decide la lógica SWR con fetchedAt; el max-age solo evita
    // que la entrada viva para siempre en el edge.
    await caches.default.put(
      CACHE_KEY,
      new Response(JSON.stringify(response), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${STALE_MAX_MS / 1000}`,
        },
      })
    );
  } catch {
    // idem: mejor-esfuerzo
  }
}

async function refreshFires(mapKey: string, env: Env): Promise<FiresResponse> {
  const jobs: Array<Promise<FireHotspot[]>> = [];
  for (const sensor of MERGED_SENSORS) {
    for (const area of AREAS) {
      jobs.push(fetchArea(mapKey, sensor, area.bbox));
    }
  }
  const [settled, index] = await Promise.all([Promise.allSettled(jobs), loadIndex(env)]);
  const fulfilled = settled.filter(
    (r): r is PromiseFulfilledResult<FireHotspot[]> => r.status === 'fulfilled'
  );
  if (fulfilled.length === 0) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }

  const cutoff = Date.now() - WINDOW_HOURS * 3_600_000;
  const hotspots = fulfilled
    .flatMap((r) => r.value)
    .filter((h) => isInSpain(h.longitude, h.latitude))
    .filter((h) => acqTimestamp(h) >= cutoff)
    .sort((a, b) => acqTimestamp(b) - acqTimestamp(a));

  return {
    count: hotspots.length,
    windowHours: WINDOW_HOURS,
    sensors: [...MERGED_SENSORS],
    partial: fulfilled.length < settled.length,
    fetchedAt: new Date().toISOString(),
    cached: false,
    hotspots,
    impact: computeImpact(hotspots, index),
  };
}

async function fetchArea(mapKey: string, sensor: string, bbox: string): Promise<FireHotspot[]> {
  try {
    return await fetchAreaOnce(mapKey, sensor, bbox);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return fetchAreaOnce(mapKey, sensor, bbox);
  }
}

async function fetchAreaOnce(mapKey: string, sensor: string, bbox: string): Promise<FireHotspot[]> {
  const url = `${FIRMS_BASE}/${mapKey}/${sensor}/${bbox}/${FETCH_DAYS}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new ApiError(504, 'FIRMS_UNREACHABLE', 'No se pudo contactar con NASA FIRMS.');
  }
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(502, 'FIRMS_ERROR', `FIRMS devolvió HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!text.trimStart().toLowerCase().startsWith('latitude')) {
    throw new ApiError(502, 'FIRMS_ERROR', `Respuesta inesperada de FIRMS: ${text.trim().slice(0, 200)}`);
  }
  return parseFirmsCsv(text);
}

/** Parser mínimo del CSV de FIRMS (sin comas embebidas ni comillas). */
function parseFirmsCsv(text: string): FireHotspot[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  const iLat = header.indexOf('latitude');
  const iLon = header.indexOf('longitude');
  const iDate = header.indexOf('acq_date');
  const iTime = header.indexOf('acq_time');
  const iSat = header.indexOf('satellite');
  const iInst = header.indexOf('instrument');
  const iConf = header.indexOf('confidence');
  const iFrp = header.indexOf('frp');
  if (iLat === -1 || iLon === -1) {
    throw new ApiError(502, 'CSV_PARSE_ERROR', 'CSV de FIRMS sin columnas latitude/longitude.');
  }

  const out: FireHotspot[] = [];
  for (let k = 1; k < lines.length; k++) {
    const f = lines[k].split(',');
    const latitude = Number(f[iLat]);
    const longitude = Number(f[iLon]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const frp = Number(f[iFrp]);
    out.push({
      latitude,
      longitude,
      acqDate: f[iDate] ?? '',
      acqTime: (f[iTime] ?? '').padStart(4, '0'),
      satellite: f[iSat] ?? '',
      instrument: f[iInst] ?? '',
      confidence: f[iConf] ?? '',
      frp: Number.isFinite(frp) ? frp : null,
    });
  }
  return out;
}

function acqTimestamp(h: FireHotspot): number {
  const [y, m, d] = h.acqDate.split('-').map(Number);
  const hh = Number(h.acqTime.slice(0, 2));
  const mm = Number(h.acqTime.slice(2));
  if (!y || !m || !d) return 0;
  return Date.UTC(y, m - 1, d, hh || 0, mm || 0);
}
