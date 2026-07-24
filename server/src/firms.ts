import Papa from 'papaparse';
import { isInSpain } from './geo';
import { computeImpact } from './impact';
import { ApiError, FireHotspot, FiresResponse } from './types';

const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

/**
 * Áreas de recogida (oeste,sur,este,norte). FIRMS solo admite un bbox
 * rectangular por petición, así que España se cubre con dos: península +
 * Baleares + Ceuta y Melilla, y Canarias. Al ser rectángulos entran también
 * franjas limítrofes (Portugal, sur de Francia, norte de Marruecos).
 */
const AREAS = [
  { name: 'peninsula-baleares', bbox: '-9.50,35.10,4.40,43.95' },
  { name: 'canarias', bbox: '-18.40,27.40,-13.30,29.50' },
] as const;

/**
 * Vista "momento actual": unión de los tres satélites VIIRS (375 m) —igual que
 * hace el visor de FIRMS— filtrada a una ventana móvil de 24 horas. Cada
 * satélite pasa sobre España a horas distintas, así que fusionarlos da la foto
 * más completa de lo que está ardiendo ahora.
 */
// Los tres VIIRS comparten plano orbital: pasan sobre España casi a la misma
// hora solar (~13:30 y ~01:30 locales), así que dejan un hueco de ~11 h por la
// tarde-noche. MODIS (Terra + Aqua, en el mismo id de sensor) pasa a otras
// horas —Terra sobre las 22:30 locales— y rellena justo ese hueco. Resolución
// 1 km frente a los 375 m de VIIRS: menos fino, pero cubre cuando no hay nada.
const MERGED_SENSORS = [
  'VIIRS_SNPP_NRT',
  'VIIRS_NOAA20_NRT',
  'VIIRS_NOAA21_NRT',
  'MODIS_NRT',
] as const;
const WINDOW_HOURS = 24;
// FIRMS solo filtra por días naturales UTC: se piden 2 (hoy + ayer) y la
// ventana de 24 h se recorta aquí, porque siempre cruza la medianoche UTC.
// Coste por renovación: 8 peticiones (4 sensores × 2 áreas) cada ~5 min,
// muy por debajo del límite de 5000/10 min.
const FETCH_DAYS = 2;

// Cache stale-while-revalidate: FIRMS limita a 5000 req/10 min por MAP_KEY y
// sus datos NRT no cambian más rápido que unos minutos.
// - fresco (< 5 min, alineado con el auto-refresco del frontend): se sirve de
//   memoria sin tocar FIRMS.
// - caducado pero servible (< 30 min): se responde AL INSTANTE con lo último
//   bueno y la renovación corre en segundo plano — ningún cliente paga la
//   latencia del fan-out a FIRMS en su petición.
// - single-flight: mil clientes simultáneos con cache fría = una sola renovación.
// - una ronda PARCIAL (algún satélite caído) nunca sustituye a una foto
//   completa anterior: mejor dato completo de hace unos minutos que uno
//   incompleto de ahora.
// Presupuesto de tiempo del fan-out: un satélite colgado no puede dejar la
// petición esperando indefinidamente; pasado el plazo se responde con lo que
// haya llegado y se marca partial.
const AREA_TIMEOUT_MS = 12_000;
const AREA_DEADLINE_MS = 26_000;

const FRESH_MS = 5 * 60 * 1000;
const STALE_MAX_MS = 30 * 60 * 1000;
let cacheEntry: { response: FiresResponse; at: number } | null = null;
let inFlight: Promise<FiresResponse> | null = null;

export async function getFires(): Promise<FiresResponse> {
  const mapKey = process.env.FIRMS_MAP_KEY;
  if (!mapKey) {
    throw new ApiError(
      503,
      'NO_MAP_KEY',
      'Falta FIRMS_MAP_KEY en server/.env. Solicita una clave gratuita en ' +
        'https://firms.modaps.eosdis.nasa.gov/api/map_key/ , copia server/.env.example ' +
        'a server/.env, rellénala y reinicia el servidor.'
    );
  }

  const now = Date.now();
  // Una respuesta parcial nunca cuenta como "fresca": se sirve al instante
  // (rama stale de abajo) pero se sigue intentando completar.
  if (cacheEntry && now - cacheEntry.at < FRESH_MS && !cacheEntry.response.partial) {
    return { ...cacheEntry.response, cached: true };
  }

  if (!inFlight) {
    inFlight = refreshFires(mapKey)
      .then((response) => {
        // Solo se reemplaza lo que teníamos si la ronda nueva es completa, o
        // si lo que había era también parcial (o nada).
        if (!response.partial || !cacheEntry || cacheEntry.response.partial) {
          cacheEntry = { response, at: Date.now() };
        }
        return response;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  if (cacheEntry && now - cacheEntry.at < STALE_MAX_MS) {
    // El fallo de la renovación en segundo plano no debe tumbar nada aquí:
    // ya estamos respondiendo con el último dato bueno.
    inFlight.catch(() => {});
    return { ...cacheEntry.response, cached: true };
  }

  return inFlight;
}

/** Tope duro por trabajo, cubriendo intento + reintento. */
function withDeadline(job: Promise<FireHotspot[]>): Promise<FireHotspot[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<FireHotspot[]>((_, reject) => {
    timer = setTimeout(
      () => reject(new ApiError(504, 'FIRMS_TIMEOUT', 'FIRMS agotó el plazo de la ronda.')),
      AREA_DEADLINE_MS
    );
  });
  return Promise.race([job.finally(() => clearTimeout(timer)), deadline]);
}

async function refreshFires(mapKey: string): Promise<FiresResponse> {
  const jobs: Array<Promise<FireHotspot[]>> = [];
  for (const sensor of MERGED_SENSORS) {
    for (const area of AREAS) {
      jobs.push(withDeadline(fetchArea(mapKey, sensor, area.bbox, FETCH_DAYS)));
    }
  }
  // allSettled: la caída transitoria de un satélite no tumba la vista entera;
  // se responde con lo que haya y se marca partial.
  const settled = await Promise.allSettled(jobs);
  const fulfilled = settled.filter(
    (r): r is PromiseFulfilledResult<FireHotspot[]> => r.status === 'fulfilled'
  );
  if (fulfilled.length === 0) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }

  const cutoff = Date.now() - WINDOW_HOURS * 3_600_000;
  // Las áreas no se solapan y cada sensor aporta pasadas distintas, así que la
  // fusión no necesita deduplicar. El recorte por contorno descarta los focos
  // de países vecinos que entran en los bbox rectangulares.
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
    impact: computeImpact(hotspots),
  };
}

/** Momento de adquisición (ms UTC) a partir de acq_date + acq_time de FIRMS. */
function acqTimestamp(h: FireHotspot): number {
  const [y, m, d] = h.acqDate.split('-').map(Number);
  const hh = Number(h.acqTime.slice(0, 2));
  const mm = Number(h.acqTime.slice(2));
  if (!y || !m || !d) return 0; // fecha malformada: queda fuera de la ventana
  return Date.UTC(y, m - 1, d, hh || 0, mm || 0);
}

/**
 * FIRMS falla esporádicamente ante ráfagas de peticiones concurrentes (aquí
 * van 6 a la vez): un único reintento con pausa corta elimina casi todos los
 * "partial" sin comprometer el rate limit.
 */
async function fetchArea(
  mapKey: string,
  sensor: string,
  bbox: string,
  days: number
): Promise<FireHotspot[]> {
  try {
    return await fetchAreaOnce(mapKey, sensor, bbox, days);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return fetchAreaOnce(mapKey, sensor, bbox, days);
  }
}

async function fetchAreaOnce(
  mapKey: string,
  sensor: string,
  bbox: string,
  days: number
): Promise<FireHotspot[]> {
  const url = `${FIRMS_BASE}/${mapKey}/${sensor}/${bbox}/${days}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(AREA_TIMEOUT_MS) });
  } catch {
    throw new ApiError(
      504,
      'FIRMS_UNREACHABLE',
      'No se pudo contactar con NASA FIRMS (timeout o error de red). Reintenta en unos minutos.'
    );
  }

  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(502, 'FIRMS_ERROR', `FIRMS devolvió HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  // FIRMS responde 200 con texto plano ("Invalid MAP_KEY.", avisos de límite...)
  // en vez de códigos de error: la única señal fiable es la cabecera del CSV.
  if (!text.trimStart().toLowerCase().startsWith('latitude')) {
    throw new ApiError(502, 'FIRMS_ERROR', `Respuesta inesperada de FIRMS: ${text.trim().slice(0, 200)}`);
  }

  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new ApiError(502, 'CSV_PARSE_ERROR', `CSV de FIRMS no parseable: ${first.message}`);
  }
  return parsed.data.map(rowToHotspot);
}

function num(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rowToHotspot(row: Record<string, string>): FireHotspot {
  return {
    latitude: num(row.latitude) ?? 0,
    longitude: num(row.longitude) ?? 0,
    acqDate: row.acq_date ?? '',
    // FIRMS emite la hora como entero ("142" = 01:42 UTC): normalizamos a HHMM.
    acqTime: (row.acq_time ?? '').padStart(4, '0'),
    satellite: row.satellite ?? '',
    instrument: row.instrument ?? '',
    confidence: row.confidence ?? '',
    frp: num(row.frp),
  };
}
