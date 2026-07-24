import { ApiError, EffisRange, EffisStatus } from './types';

/**
 * Port a Workers de server/src/effis.ts. Misma estrategia: lista de candidatos
 * con sonda realista, estado con TTL corto en fallo, y tiles con
 * stale-if-error de 24 h. El estado y los tiles viven en variables de módulo:
 * por-isolate, mejor-esfuerzo — suficiente para un upstream que se cae solo.
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

const PROBE_BBOX = '-560000,4880000,-380000,5000000';
const PROBE_SIZE = 256;

const BBOX_RE = /^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/;
const RANGES: ReadonlySet<string> = new Set(['7d', '30d', 'season']);

const STATUS_OK_TTL = 10 * 60 * 1000;
const STATUS_FAIL_TTL = 45 * 1000;
let statusEntry: { status: EffisStatus; expiresAt: number } | null = null;
let statusInFlight: Promise<EffisStatus> | null = null;
let activeCandidate: EffisCandidate | null = null;

const TILE_FRESH_MS = 30 * 60 * 1000;
const TILE_STALE_MAX_MS = 24 * 60 * 60 * 1000;
const TILE_MAX_ENTRIES = 300;
interface CachedTile {
  body: ArrayBuffer;
  contentType: string;
  at: number;
}
const tileStore = new Map<string, CachedTile>();

const TILE_FAILURE_THRESHOLD = 3;
let tileFailureStreak = 0;

export async function getEffisStatus(): Promise<EffisStatus> {
  if (statusEntry && Date.now() < statusEntry.expiresAt) return statusEntry.status;
  if (!statusInFlight) {
    statusInFlight = probeCandidates().finally(() => {
      statusInFlight = null;
    });
  }
  return statusInFlight;
}

async function probeCandidates(): Promise<EffisStatus> {
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
    statusEntry = { status, expiresAt: Date.now() + STATUS_OK_TTL };
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
  statusEntry = { status, expiresAt: Date.now() + STATUS_FAIL_TTL };
  return status;
}

async function probe(candidate: EffisCandidate): Promise<boolean> {
  const url = buildGetMapUrl(candidate, '7d', PROBE_BBOX, PROBE_SIZE, PROBE_SIZE);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || !contentType.startsWith('image/')) return false;
    await res.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

function reportTileOutcome(ok: boolean): void {
  if (ok) {
    tileFailureStreak = 0;
    return;
  }
  tileFailureStreak += 1;
  if (tileFailureStreak >= TILE_FAILURE_THRESHOLD) {
    statusEntry = null;
    tileFailureStreak = 0;
  }
}

export async function fetchEffisTile(
  rangeRaw: string,
  bbox: string,
  widthRaw: string,
  heightRaw: string
): Promise<CachedTile> {
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
  return { body: await res.arrayBuffer(), contentType, at: Date.now() };
}

function storeTile(key: string, tile: CachedTile): void {
  if (!tileStore.has(key) && tileStore.size >= TILE_MAX_ENTRIES) {
    const oldest = tileStore.keys().next().value;
    if (oldest !== undefined) tileStore.delete(oldest);
  }
  tileStore.set(key, tile);
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
  if (candidate.supportsTime) params.set('TIME', timeRange(range));
  return `${candidate.base}?${params.toString()}`;
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
