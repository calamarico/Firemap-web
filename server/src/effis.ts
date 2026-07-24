import { TtlCache } from './cache';
import { ApiError, EffisRange, EffisStatus } from './types';

/**
 * Integración con EFFIS (European Forest Fire Information System, JRC/Copernicus).
 *
 * Estos servicios cambian de host y de estado con frecuencia, así que no se
 * asume un endpoint fijo: se sondea una lista ordenada de candidatos con un
 * GetMap pequeño y se usa el primero que devuelva una imagen de verdad.
 *
 * Estado verificado el 2026-07-24 vía GetCapabilities:
 * - maps.effis.emergency.copernicus.eu/effis (host del visor oficial): devolvía
 *   un error interno de MapServer ("msLoadSymbolSet"). Se prueba primero por si
 *   se recupera: es el que expone las capas de área quemada con dimensión TIME
 *   (modis.ba / nrt.ba), que permiten filtrar 7 días / 30 días / temporada.
 * - ies-ows.jrc.ec.europa.eu/effis: GetCapabilities correcto; su única capa de
 *   polígonos de área quemada es "ercc.ba" ("Current Season Burned Areas in
 *   last 30 days"), sin dimensión TIME. Sirve como fallback de rango fijo.
 */
interface EffisCandidate {
  base: string;
  layer: string;
  title: string;
  supportsTime: boolean;
}

const CANDIDATES: EffisCandidate[] = [
  {
    base: 'https://maps.effis.emergency.copernicus.eu/effis',
    layer: 'modis.ba',
    title: 'EFFIS Burnt Areas (MODIS)',
    supportsTime: true,
  },
  {
    base: 'https://maps.effis.emergency.copernicus.eu/effis',
    layer: 'nrt.ba',
    title: 'EFFIS Burnt Areas (NRT)',
    supportsTime: true,
  },
  {
    base: 'https://ies-ows.jrc.ec.europa.eu/effis',
    layer: 'ercc.ba',
    title: 'Current Season Burned Areas (last 30 days)',
    supportsTime: false,
  },
];

/**
 * La sonda pide exactamente lo que pedirá el mapa (tile de 256×256 sobre el
 * centro-oeste peninsular): estos servidores a veces contestan a un GetMap
 * diminuto pero cuelgan con renders reales, y una sonda "de juguete" daría
 * por vivo un servicio que no rinde.
 */
const PROBE_BBOX = '-560000,4880000,-380000,5000000';
const PROBE_SIZE = 256;

const BBOX_RE = /^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/;
const RANGES: ReadonlySet<string> = new Set(['7d', '30d', 'season']);

// La sonda es cara (3 GetMap en paralelo): se cachea el resultado. TTL de
// fallo corto: EFFIS se cae a menudo y queremos detectar su vuelta en ~1 min
// (el frontend también acelera su sondeo cuando lo ve caído).
const STATUS_OK_TTL = 10 * 60 * 1000;
const STATUS_FAIL_TTL = 45 * 1000;
const statusCache = new TtlCache<EffisStatus>(STATUS_OK_TTL);
let statusInFlight: Promise<EffisStatus> | null = null;

// Tiles con stale-if-error de larga duración: el área quemada cambia ~a diario
// pero este upstream se cae constantemente. Un tile fresco (< 30 min) se sirve
// de memoria; si el upstream falla, se sirve el último tile bueno hasta 24 h.
// Lo que se consiguió pintar una vez no desaparece porque EFFIS se caiga.
const TILE_FRESH_MS = 30 * 60 * 1000;
const TILE_STALE_MAX_MS = 24 * 60 * 60 * 1000;
const TILE_MAX_ENTRIES = 600;
interface CachedTile {
  body: Buffer;
  contentType: string;
  at: number;
}
const tileStore = new Map<string, CachedTile>();

function storeTile(key: string, tile: CachedTile): void {
  if (!tileStore.has(key) && tileStore.size >= TILE_MAX_ENTRIES) {
    const oldest = tileStore.keys().next().value;
    if (oldest !== undefined) tileStore.delete(oldest);
  }
  tileStore.set(key, tile);
}

let activeCandidate: EffisCandidate | null = null;

export async function getEffisStatus(): Promise<EffisStatus> {
  const cached = statusCache.get('status');
  if (cached) return cached;
  // Single-flight: si varios tiles llegan a la vez sin status cacheado, solo
  // se lanza una ronda de sondas.
  if (!statusInFlight) {
    statusInFlight = probeCandidates().finally(() => {
      statusInFlight = null;
    });
  }
  return statusInFlight;
}

async function probeCandidates(): Promise<EffisStatus> {
  // Sondas en paralelo (cada una puede tardar sus 15 s de timeout): el orden
  // de preferencia se aplica después, sobre los resultados.
  const results = await Promise.all(
    CANDIDATES.map(async (candidate) => ({ candidate, ok: await probe(candidate) }))
  );
  const winner = results.find((r) => r.ok)?.candidate;
  if (winner) {
    activeCandidate = winner;
    const status: EffisStatus = {
      available: true,
      endpoint: winner.base,
      layer: winner.layer,
      layerTitle: winner.title,
      supportsTime: winner.supportsTime,
      checkedAt: new Date().toISOString(),
      note: winner.supportsTime
        ? undefined
        : 'Servicio EFFIS en modo fallback: la capa disponible cubre la temporada ' +
          'actual (últimos 30 días) y no admite filtrar por rango.',
    };
    statusCache.set('status', status, STATUS_OK_TTL);
    return status;
  }
  activeCandidate = null;
  const status: EffisStatus = {
    available: false,
    supportsTime: false,
    checkedAt: new Date().toISOString(),
    note:
      'Ningún endpoint EFFIS respondió con una imagen válida. Probados: ' +
      CANDIDATES.map((c) => `${c.base} (${c.layer})`).join('; '),
  };
  statusCache.set('status', status, STATUS_FAIL_TTL);
  return status;
}

async function probe(candidate: EffisCandidate): Promise<boolean> {
  const url = buildGetMapUrl(candidate, '7d', PROBE_BBOX, PROBE_SIZE, PROBE_SIZE);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const contentType = res.headers.get('content-type') ?? '';
    // MapServer devuelve HTTP 200 con HTML/XML cuando falla: solo cuenta
    // como vivo si responde una imagen de verdad.
    return res.ok && contentType.startsWith('image/');
  } catch {
    return false;
  }
}

// El upstream puede pasar la sonda y aun así no rendir tiles reales (visto en
// producción: sonda OK, GetMap reales colgados). Tras varios fallos seguidos
// se invalida el estado cacheado para que la próxima consulta re-sondee y la
// UI degrade al aviso de "no disponible" en vez de fingir que hay capa.
const TILE_FAILURE_THRESHOLD = 3;
let tileFailureStreak = 0;

function reportTileOutcome(ok: boolean): void {
  if (ok) {
    tileFailureStreak = 0;
    return;
  }
  tileFailureStreak += 1;
  if (tileFailureStreak >= TILE_FAILURE_THRESHOLD) {
    statusCache.delete('status');
    tileFailureStreak = 0;
  }
}

export async function fetchEffisTile(
  rangeRaw: string,
  bbox: string,
  widthRaw: string,
  heightRaw: string
): Promise<{ body: Buffer; contentType: string }> {
  if (!RANGES.has(rangeRaw)) {
    throw new ApiError(400, 'BAD_RANGE', 'El parámetro "range" debe ser 7d, 30d o season.');
  }
  const range = rangeRaw as EffisRange;
  if (!BBOX_RE.test(bbox)) {
    throw new ApiError(400, 'BAD_BBOX', 'El parámetro "bbox" debe ser "minX,minY,maxX,maxY" en EPSG:3857.');
  }
  const width = Number(widthRaw);
  const height = Number(heightRaw);
  if (![width, height].every((n) => Number.isInteger(n) && n >= 1 && n <= 1024)) {
    throw new ApiError(400, 'BAD_SIZE', 'width y height deben ser enteros entre 1 y 1024.');
  }

  // La clave es la petición (no la URL upstream): así el stale sobrevive a un
  // cambio de endpoint activo e incluso a estados "no disponible".
  const key = `${range}|${bbox}|${width}x${height}`;
  const now = Date.now();
  const hit = tileStore.get(key);
  if (hit && now - hit.at < TILE_FRESH_MS) return hit;
  const staleUsable = hit && now - hit.at < TILE_STALE_MAX_MS ? hit : undefined;

  const status = await getEffisStatus();
  if (!status.available || !activeCandidate) {
    if (staleUsable) return staleUsable;
    throw new ApiError(503, 'EFFIS_UNAVAILABLE', status.note ?? 'EFFIS no disponible.');
  }

  const url = buildGetMapUrl(activeCandidate, range, bbox, width, height);
  try {
    // Upstream inestable: dos intentos cortos rinden más que uno largo.
    const tile = await fetchTileOnce(url, 12_000).catch(() => fetchTileOnce(url, 12_000));
    reportTileOutcome(true);
    storeTile(key, tile);
    return tile;
  } catch (err) {
    reportTileOutcome(false);
    if (staleUsable) return staleUsable;
    throw err;
  }
}

async function fetchTileOnce(url: string, timeoutMs: number): Promise<CachedTile> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ApiError(504, 'EFFIS_UNREACHABLE', 'EFFIS no respondió a tiempo al pedir el tile.');
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok || !contentType.startsWith('image/')) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new ApiError(502, 'EFFIS_ERROR', `EFFIS devolvió una respuesta no válida: ${detail}`);
  }
  return { body: Buffer.from(await res.arrayBuffer()), contentType, at: Date.now() };
}

function buildGetMapUrl(
  candidate: EffisCandidate,
  range: EffisRange,
  bbox: string,
  width: number,
  height: number
): string {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetMap',
    LAYERS: candidate.layer,
    STYLES: '',
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
    SRS: 'EPSG:3857',
    BBOX: bbox,
    WIDTH: String(width),
    HEIGHT: String(height),
  });
  if (candidate.supportsTime) {
    params.set('TIME', timeRange(range));
  }
  return `${candidate.base}?${params.toString()}`;
}

/** Rango temporal WMS "inicio/fin" en fechas UTC (formato de MapServer). */
function timeRange(range: EffisRange): string {
  const end = new Date();
  const start = new Date(end);
  if (range === '7d') start.setUTCDate(end.getUTCDate() - 7);
  else if (range === '30d') start.setUTCDate(end.getUTCDate() - 30);
  else {
    start.setUTCMonth(0, 1); // temporada = desde el 1 de enero del año en curso
  }
  return `${isoDate(start)}/${isoDate(end)}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
