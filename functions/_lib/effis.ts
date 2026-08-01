import { centerPixel } from './fwi';
import { ApiError, EffisRange, EffisStatus } from './types';

/**
 * Port a Workers de server/src/effis.ts. Misma estrategia: lista de candidatos
 * con sonda realista, estado con TTL corto en fallo, y tiles con
 * stale-if-error de 24 h. El estado y los tiles viven en variables de módulo:
 * por-isolate, mejor-esfuerzo — suficiente para un upstream que se cae solo.
 *
 * Parametrizado por PRODUCTO desde 2026-08: 'ba' (área quemada, la capa de
 * siempre) y 'danger' (riesgo de incendio, FWI). Cada producto tiene sus
 * candidatos, su parámetro temporal (rango para ba, día D0-D8 para danger) y
 * su ESTADO/CACHÉ PROPIOS — compartirlos mezclaría tiles de capas distintas
 * bajo la misma clave y una caída de GWIS marcaría caído el área quemada.
 */

export type EffisProduct = 'ba' | 'danger';

interface EffisCandidate {
  base: string;
  layer: string;
  title: string;
  supportsTime: boolean;
}

const BA_CANDIDATES: EffisCandidate[] = [
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
 * Riesgo: ecmwf.fwi de GWIS (~8 km, previsión D0-D8) con mf010.fwi (~10 km,
 * D0-D2) de reserva. ies-ows NO entra: su backend Oracle está caído y sus
 * rasters salen vacíos (verificado 2026-08-01).
 */
const DANGER_CANDIDATES: EffisCandidate[] = [
  {
    base: 'https://maps.effis.emergency.copernicus.eu/gwis',
    layer: 'ecmwf.fwi',
    title: 'Fire Weather Index (ECMWF)',
    supportsTime: true,
  },
  {
    base: 'https://maps.effis.emergency.copernicus.eu/effis',
    layer: 'mf010.fwi',
    title: 'Fire Weather Index (MeteoFrance)',
    supportsTime: true,
  },
];

const PROBE_BBOX = '-560000,4880000,-380000,5000000';
const PROBE_SIZE = 256;
// Cuando EFFIS cae no rechaza la conexión: la deja abierta sin contestar nada
// (medido el 2026-07-24: 25 s, cero bytes). El timeout es corto a propósito —
// es tiempo que alguien está esperando, y un EFFIS lento no debe costar nada.
const PROBE_TIMEOUT_MS = 6_000;
const TILE_TIMEOUT_MS = 8_000;

const BBOX_RE = /^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/;
const RANGES: ReadonlySet<string> = new Set(['7d', '30d', 'season']);
/** Días de previsión de la capa de riesgo (D0 = hoy). El cliente solo expone
 *  D0 por ahora; el fallback MeteoFrance solo cubre D0-D2. */
const DANGER_DAYS: ReadonlySet<string> = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8']);

const STATUS_OK_TTL = 10 * 60 * 1000;
const STATUS_FAIL_TTL = 45 * 1000;

const TILE_FRESH_MS = 30 * 60 * 1000;
const TILE_STALE_MAX_MS = 24 * 60 * 60 * 1000;
const TILE_MAX_ENTRIES = 300;
interface CachedTile {
  body: ArrayBuffer;
  contentType: string;
  at: number;
}

const TILE_FAILURE_THRESHOLD = 3;

interface ProductState {
  candidates: EffisCandidate[];
  statusEntry: { status: EffisStatus; expiresAt: number } | null;
  statusInFlight: Promise<EffisStatus> | null;
  activeCandidate: EffisCandidate | null;
  tileStore: Map<string, CachedTile>;
  tileFailureStreak: number;
}

function newState(candidates: EffisCandidate[]): ProductState {
  return {
    candidates,
    statusEntry: null,
    statusInFlight: null,
    activeCandidate: null,
    tileStore: new Map(),
    tileFailureStreak: 0,
  };
}

const STATES: Record<EffisProduct, ProductState> = {
  ba: newState(BA_CANDIDATES),
  danger: newState(DANGER_CANDIDATES),
};

/**
 * Estado de EFFIS con stale-while-revalidate: si hay un estado anterior
 * (aunque caducado) se responde AL INSTANTE y la sonda corre en segundo plano.
 * Antes, cada expiración obligaba a un cliente a esperar la ronda de sondas
 * completa contra un upstream que se cuelga sin contestar — de ahí los 30 s de
 * espera y algún 524. Solo el primer sondeo de un isolate frío espera.
 */
export function getEffisStatus(
  waitUntil?: (p: Promise<unknown>) => void,
  product: EffisProduct = 'ba'
): Promise<EffisStatus> {
  const state = STATES[product];
  const entry = state.statusEntry;
  if (entry && Date.now() < entry.expiresAt) return Promise.resolve(entry.status);

  if (!state.statusInFlight) {
    state.statusInFlight = probeCandidates(state, product).finally(() => {
      state.statusInFlight = null;
    });
  }
  if (entry && waitUntil) {
    waitUntil(state.statusInFlight.catch(() => {}));
    return Promise.resolve(entry.status);
  }
  return state.statusInFlight;
}

async function probeCandidates(state: ProductState, product: EffisProduct): Promise<EffisStatus> {
  const results = await Promise.all(
    state.candidates.map(async (candidate) => ({
      candidate,
      ok: await (product === 'danger' ? probeDanger(candidate) : probeBa(candidate)),
    }))
  );
  const winner = results.find((r) => r.ok)?.candidate;
  if (winner) {
    state.activeCandidate = winner;
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
    state.statusEntry = { status, expiresAt: Date.now() + STATUS_OK_TTL };
    return status;
  }
  state.activeCandidate = null;
  const status: EffisStatus = {
    available: false,
    supportsTime: false,
    checkedAt: new Date().toISOString(),
    note:
      'Ningún endpoint EFFIS respondió con una imagen válida. Probados: ' +
      state.candidates.map((c) => `${c.base} (${c.layer})`).join('; '),
  };
  state.statusEntry = { status, expiresAt: Date.now() + STATUS_FAIL_TTL };
  return status;
}

async function probeBa(candidate: EffisCandidate): Promise<boolean> {
  const url = buildGetMapUrl(candidate, 'ba', '7d', PROBE_BBOX, PROBE_SIZE, PROBE_SIZE);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || !contentType.startsWith('image/')) return false;
    // No basta con "es una imagen": degradado, EFFIS responde 200 con un PNG
    // opaco (blanco). Un candidato solo vale si respeta TRANSPARENT=TRUE.
    return pngCanBeTransparent(await res.arrayBuffer());
  } catch {
    return false;
  }
}

/**
 * La sonda del riesgo es la INVERSA de la del área quemada: su modo "sin
 * datos" es un PNG 100 % transparente (que pngCanBeTransparent daría por
 * bueno), así que se pide un GetMap 8×8 sobre el centro peninsular y se exige
 * un píxel PINTADO — el FWI es un raster continuo: sobre tierra siempre hay
 * clase.
 */
async function probeDanger(candidate: EffisCandidate): Promise<boolean> {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetMap',
    LAYERS: candidate.layer,
    STYLES: '',
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
    SRS: 'EPSG:4326',
    BBOX: '-4.5,39.5,-3.5,40.5',
    WIDTH: '8',
    HEIGHT: '8',
    TIME: dangerTime('0'),
  });
  try {
    const res = await fetch(`${candidate.base}?${params.toString()}`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return false;
    const pixel = await centerPixel(new Uint8Array(await res.arrayBuffer()));
    return pixel !== null && pixel[3] > 0;
  } catch {
    return false;
  }
}

/**
 * true si el PNG puede contener transparencia: canal alfa (color types 4/6)
 * o chunk tRNS. Cuando EFFIS degrada, su WMS ignora TRANSPARENT=TRUE y emite
 * PNG opacos blancos con 200: pintarlos taparía el mapa entero, así que un
 * tile sin capacidad de transparencia se trata como fallo. Solo se lee la
 * cabecera y la lista de chunks — nada que descomprimir, coste ~0.
 */
function pngCanBeTransparent(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf);
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 26 || !SIG.every((v, i) => b[i] === v)) return false;
  const colorType = b[25]; // byte fijo de IHDR (primer chunk obligatorio)
  if (colorType === 4 || colorType === 6) return true;
  // Gris/RGB/paleta sin alfa: solo transparente si declara tRNS antes de IDAT.
  let off = 8;
  while (off + 8 <= b.length) {
    const len = ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
    const type = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
    if (type === 'tRNS') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    off += 12 + len; // longitud + tipo + datos + CRC
  }
  return false;
}

function reportTileOutcome(state: ProductState, ok: boolean): void {
  if (ok) {
    state.tileFailureStreak = 0;
    return;
  }
  state.tileFailureStreak += 1;
  if (state.tileFailureStreak >= TILE_FAILURE_THRESHOLD) {
    // Se marca caducado, no se borra: así el siguiente cliente recibe este
    // estado al instante mientras la sonda se rehace de fondo.
    if (state.statusEntry) state.statusEntry = { ...state.statusEntry, expiresAt: 0 };
    state.tileFailureStreak = 0;
  }
}

export async function fetchEffisTile(
  rangeRaw: string,
  bbox: string,
  widthRaw: string,
  heightRaw: string,
  waitUntil?: (p: Promise<unknown>) => void,
  product: EffisProduct = 'ba'
): Promise<CachedTile> {
  if (product === 'ba' && !RANGES.has(rangeRaw)) {
    throw new ApiError(400, 'BAD_RANGE', 'El parámetro "range" debe ser 7d, 30d o season.');
  }
  if (product === 'danger' && !DANGER_DAYS.has(rangeRaw)) {
    throw new ApiError(400, 'BAD_DAY', 'El parámetro "day" debe ser un entero entre 0 y 8.');
  }
  if (!BBOX_RE.test(bbox)) {
    throw new ApiError(400, 'BAD_BBOX', 'El parámetro "bbox" debe ser "minX,minY,maxX,maxY" en EPSG:3857.');
  }
  const width = Number(widthRaw);
  const height = Number(heightRaw);
  if (![width, height].every((n) => Number.isInteger(n) && n >= 1 && n <= 1024)) {
    throw new ApiError(400, 'BAD_SIZE', 'width y height deben ser enteros entre 1 y 1024.');
  }

  const state = STATES[product];
  const key = `${product}|${rangeRaw}|${bbox}|${width}x${height}`;
  const now = Date.now();
  const hit = state.tileStore.get(key);
  if (hit && now - hit.at < TILE_FRESH_MS) return hit;
  const staleUsable = hit && now - hit.at < TILE_STALE_MAX_MS ? hit : undefined;

  // Con el servicio caído esto corta aquí sin tocar el upstream: la petición
  // se resuelve en milisegundos en vez de colgarse hasta el timeout.
  const status = await getEffisStatus(waitUntil, product);
  if (!status.available || !state.activeCandidate) {
    if (staleUsable) return staleUsable;
    throw new ApiError(503, 'EFFIS_UNAVAILABLE', status.note ?? 'EFFIS no disponible.');
  }

  const url = buildGetMapUrl(state.activeCandidate, product, rangeRaw, bbox, width, height);
  try {
    const tile = await fetchTileOnce(url, TILE_TIMEOUT_MS, product).catch((err) => {
      // Si el fallo fue un timeout, EFFIS está colgado y reintentar solo suma
      // otros 8 s de espera al cliente. Solo se reintenta cuando contestó algo.
      if (err instanceof ApiError && err.code === 'EFFIS_UNREACHABLE') throw err;
      return fetchTileOnce(url, TILE_TIMEOUT_MS, product);
    });
    reportTileOutcome(state, true);
    storeTile(state, key, tile);
    return tile;
  } catch (err) {
    reportTileOutcome(state, false);
    if (staleUsable) return staleUsable;
    throw err;
  }
}

async function fetchTileOnce(
  url: string,
  timeoutMs: number,
  product: EffisProduct
): Promise<CachedTile> {
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
  const body = await res.arrayBuffer();
  if (product === 'ba' && !pngCanBeTransparent(body)) {
    // Tile opaco = el modo degradado de EFFIS. Mejor no pintar nada (y no
    // cachearlo) que tapar el mapa con placas blancas. (El riesgo no pasa este
    // control: su raster es opaco POR DISEÑO; su modo degradado —vacío— lo
    // detecta la sonda de píxel pintado.)
    throw new ApiError(502, 'EFFIS_OPAQUE', 'EFFIS devolvió un tile opaco (modo degradado).');
  }
  return { body, contentType, at: Date.now() };
}

function storeTile(state: ProductState, key: string, tile: CachedTile): void {
  if (!state.tileStore.has(key) && state.tileStore.size >= TILE_MAX_ENTRIES) {
    const oldest = state.tileStore.keys().next().value;
    if (oldest !== undefined) state.tileStore.delete(oldest);
  }
  state.tileStore.set(key, tile);
}

function buildGetMapUrl(
  candidate: EffisCandidate,
  product: EffisProduct,
  rangeRaw: string,
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
    // El área quemada filtra por INTERVALO (inicio/fin); la previsión de
    // riesgo pide UN día concreto (D0-D8).
    params.set('TIME', product === 'danger' ? dangerTime(rangeRaw) : timeRange(rangeRaw as EffisRange));
  }
  return `${candidate.base}?${params.toString()}`;
}

function dangerTime(dayRaw: string): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Number(dayRaw));
  return isoDate(d);
}

function timeRange(range: EffisRange): string {
  const end = new Date();
  const start = new Date(end);
  if (range === '7d') start.setUTCDate(end.getUTCDate() - 7);
  else if (range === '30d') start.setUTCDate(end.getUTCDate() - 30);
  else start.setUTCMonth(0, 1);
  return `${isoDate(start)}/${isoDate(end)}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
