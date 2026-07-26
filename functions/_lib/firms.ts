import { isInCoverage } from './geo';
import { computeImpact, loadIndex } from './impact';
import { ApiError, Env, FireHotspot, FiresResponse } from './types';

/**
 * Port a Workers de server/src/firms.ts, con dos adaptaciones:
 * - CSV parseado a mano (sin papaparse): el CSV de FIRMS no lleva comas
 *   embebidas y el parser propio gasta una fracción del CPU — importa con el
 *   límite de 10 ms/invocación del free plan.
 * - Cache en tres niveles: variable de módulo (válida mientras el isolate
 *   viva) + Cache API para isolates fríos + KV para datacenters fríos. Las dos
 *   primeras son locales a cada datacenter de Cloudflare; KV es la única capa
 *   global, y es la que mantiene fresco el cron de keep-warm (/api/warm)
 *   aunque pinche desde un colo distinto al de los usuarios.
 */

const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

const AREAS = [
  { name: 'peninsula-baleares', bbox: '-9.80,35.10,4.40,43.95' },
  { name: 'canarias', bbox: '-18.40,27.40,-13.30,29.50' },
] as const;

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
const FETCH_DAYS = 2;

const FRESH_MS = 5 * 60 * 1000;
const STALE_MAX_MS = 30 * 60 * 1000;
// Presupuesto de tiempo del fan-out. Cloudflare corta con 524 si la Function
// no responde, así que una ronda con un satélite colgado no puede quedarse
// esperando: pasado el plazo se responde con lo que haya llegado (partial).
const AREA_TIMEOUT_MS = 12_000;
const AREA_DEADLINE_MS = 20_000;
// Petición cubierta (hedge): si el primer intento no responde en este plazo se
// lanza un duplicado y gana el que llegue antes. El cupo de FIRMS (5000
// transacciones/10 min; un refresh completo ronda las 64) hace que el
// duplicado salga gratis.
const HEDGE_DELAY_MS = 4_000;
// Pausa antes del duplicado cuando el primer intento FALLA (en vez de
// colgarse): FIRMS rechaza a veces ráfagas concurrentes y reintentar en el
// acto suele tropezar con la misma ráfaga.
const RETRY_PAUSE_MS = 1_500;
// Clave sintética para la Cache API (el host es irrelevante: es un espacio de
// nombres). Versionada: al cambiar el contrato (p. ej. bbox en el ranking) se
// sube la versión y las entradas viejas quedan huérfanas.
const CACHE_KEY = 'https://firemap.cache/api/fires-v5';
const KV_KEY = 'api-fires-v5';
// Guarda de escritura en KV: el free plan da 1000 escrituras/día y todos los
// datacenters comparten la clave. Si lo que hay en KV tiene menos de este
// margen, la escritura se ahorra: techo global ~360/día.
const KV_MIN_WRITE_MS = 4 * 60 * 1000;
// Más allá de STALE_MAX_MS el dato ya no se sirve; el TTL solo limpia.
const KV_TTL_S = 3600;

let cacheEntry: { response: FiresResponse; at: number } | null = null;
let inFlight: Promise<FiresResponse> | null = null;

function isFresh(): boolean {
  return cacheEntry !== null && Date.now() - cacheEntry.at < FRESH_MS && !cacheEntry.response.partial;
}

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

  // KV es la única capa global: si aquí no hay dato fresco, otro datacenter —o
  // el cron de keep-warm— puede haber dejado uno hace segundos. Leerlo cuesta
  // milisegundos; el fan-out a FIRMS, segundos. Con una renovación ya en
  // marcha no se consulta: su resultado va a llegar de todos modos.
  if (!isFresh() && !inFlight) await warmFromKv(env);

  if (isFresh()) {
    return { ...cacheEntry!.response, cached: true };
  }

  const now = Date.now();
  if (!inFlight) {
    inFlight = refreshFires(mapKey, env)
      .then((response) => {
        if (!response.partial || !cacheEntry || cacheEntry.response.partial) {
          cacheEntry = { response, at: Date.now() };
          waitUntil(saveToCacheApi(response));
          waitUntil(saveToKv(env, response));
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

async function warmFromKv(env: Env): Promise<void> {
  if (!env.FIRES_KV) return;
  try {
    const response = await env.FIRES_KV.get<FiresResponse>(KV_KEY, 'json');
    if (!response) return;
    const at = Date.parse(response.fetchedAt);
    if (!Number.isFinite(at)) return;
    // Solo se adopta si mejora lo que hay: más nuevo, y nunca un parcial por
    // encima de una foto completa (misma regla que la cache de módulo).
    if (cacheEntry && at <= cacheEntry.at) return;
    if (response.partial && cacheEntry && !cacheEntry.response.partial) return;
    cacheEntry = { response, at };
  } catch {
    // KV es mejor-esfuerzo, como la Cache API
  }
}

async function saveToKv(env: Env, response: FiresResponse): Promise<void> {
  if (!env.FIRES_KV) return;
  try {
    const existing = await env.FIRES_KV.get<FiresResponse>(KV_KEY, 'json');
    if (existing) {
      const existingAt = Date.parse(existing.fetchedAt);
      if (Number.isFinite(existingAt)) {
        const age = Date.now() - existingAt;
        if (age < KV_MIN_WRITE_MS) return;
        // Un parcial no pisa una foto completa mientras esta siga servible.
        if (response.partial && !existing.partial && age < STALE_MAX_MS) return;
      }
    }
    await env.FIRES_KV.put(KV_KEY, JSON.stringify(response), { expirationTtl: KV_TTL_S });
  } catch {
    // idem: mejor-esfuerzo
  }
}

async function refreshFires(mapKey: string, env: Env): Promise<FiresResponse> {
  const jobs: Array<Promise<FireHotspot[]>> = [];
  for (const sensor of MERGED_SENSORS) {
    for (const area of AREAS) {
      jobs.push(withDeadline(fetchArea(mapKey, sensor, area.bbox)));
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
    .filter((h) => isInCoverage(h.longitude, h.latitude))
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

/**
 * Tope duro por trabajo, cubriendo el intento y su hedge (peor caso real
 * ~17,5 s: fallo justo antes del hedge + pausa + timeout). Sin esto, el peor
 * caso del fan-out se acumula y la Function puede pasar del límite de
 * Cloudflare y devolver 524: mejor una foto parcial a tiempo que un error.
 */
function withDeadline(job: Promise<FireHotspot[]>): Promise<FireHotspot[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<FireHotspot[]>((_, reject) => {
    timer = setTimeout(
      () => reject(new ApiError(504, 'FIRMS_TIMEOUT', 'FIRMS agotó el plazo de la ronda.')),
      AREA_DEADLINE_MS
    );
  });
  // El clearTimeout evita que un temporizador vivo alargue la invocación.
  return Promise.race([
    job.finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    deadline,
  ]);
}

/**
 * FIRMS deja peticiones colgadas 10-20 s de vez en cuando. En lugar del antiguo
 * reintento secuencial (peor caso ~25,5 s), se cubre la petición: a los
 * HEDGE_DELAY_MS sin respuesta —o tras RETRY_PAUSE_MS si falla antes— se lanza
 * un duplicado idéntico y resuelve el primero que responda bien. Solo se
 * duplica una vez; si ambos intentos fallan, se propaga el primer error.
 */
function fetchArea(mapKey: string, sensor: string, bbox: string): Promise<FireHotspot[]> {
  return new Promise((resolve, reject) => {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    let pending = 0;
    let hedged = false;
    let failure: { reason: unknown } | null = null;

    const attempt = () => {
      pending++;
      fetchAreaOnce(mapKey, sensor, bbox).then(
        (hotspots) => {
          // El clearTimeout evita que un temporizador vivo alargue la invocación.
          timers.forEach(clearTimeout);
          resolve(hotspots);
        },
        (err) => {
          pending--;
          failure ??= { reason: err };
          if (!hedged) hedge(RETRY_PAUSE_MS);
          else if (pending === 0) reject(failure.reason);
        }
      );
    };

    const hedge = (delayMs: number) => {
      hedged = true;
      timers.forEach(clearTimeout);
      timers.push(setTimeout(attempt, delayMs));
    };

    attempt();
    timers.push(setTimeout(() => hedge(0), HEDGE_DELAY_MS));
  });
}

async function fetchAreaOnce(mapKey: string, sensor: string, bbox: string): Promise<FireHotspot[]> {
  const url = `${FIRMS_BASE}/${mapKey}/${sensor}/${bbox}/${FETCH_DAYS}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(AREA_TIMEOUT_MS) });
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
