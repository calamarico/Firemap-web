import { Env, FireHotspot, MunicipalityImpact, RegionImpact } from './types';

/**
 * Ranking de localidades en Workers: en lugar del ray-casting contra 8.205
 * polígonos (inviable con 10 ms de CPU), usa el índice precalculado por
 * scripts/build-muni-index.mjs — una rejilla de 0.02° donde cada celda apunta
 * a su municipio. El lookup por foco es O(1) sobre un Uint16Array.
 *
 * Los artefactos viajan como estáticos del propio deploy (binding ASSETS) y
 * se cargan una vez por isolate: ~70 KB (gzip) el binario + ~60 KB el meta.
 */

interface MuniIndex {
  grid: Uint16Array;
  x0: number;
  y0: number;
  cell: number;
  cols: number;
  rows: number;
  regions: string[];
  municipalities: Array<{ n: string; r: number }>;
}

interface MuniMetaFile {
  grid: { x0: number; y0: number; cell: number; cols: number; rows: number };
  regions: string[];
  /** c = centroide para los deep links del frontend; aquí no se usa. */
  municipalities: Array<{ n: string; r: number; c?: [number, number] }>;
}

let indexPromise: Promise<MuniIndex | null> | null = null;

export function loadIndex(env: Env): Promise<MuniIndex | null> {
  indexPromise ??= fetchIndex(env).catch((err) => {
    console.error('No se pudo cargar el índice de municipios:', err);
    indexPromise = null; // permite reintentar en la siguiente petición
    return null;
  });
  return indexPromise;
}

async function fetchIndex(env: Env): Promise<MuniIndex | null> {
  const [gridRes, metaRes] = await Promise.all([
    env.ASSETS.fetch('https://assets.internal/data/muni-grid.bin'),
    env.ASSETS.fetch('https://assets.internal/data/muni-meta.json'),
  ]);
  if (!gridRes.ok || !metaRes.ok) return null;
  const meta = (await metaRes.json()) as MuniMetaFile;
  // El binario es Uint16 little-endian; workerd es little-endian.
  const grid = new Uint16Array(await gridRes.arrayBuffer());
  if (grid.length !== meta.grid.cols * meta.grid.rows) return null;
  return { grid, ...meta.grid, regions: meta.regions, municipalities: meta.municipalities };
}

const MAX_MUNICIPALITIES_PER_REGION = 12;
// Un único foco suele ser ruido: solo entran municipios con ≥ 2 detecciones.
const MIN_HOTSPOTS_PER_MUNICIPALITY = 2;

export function computeImpact(hotspots: FireHotspot[], index: MuniIndex | null): RegionImpact[] {
  if (!index) return [];

  interface Accum {
    count: number;
    maxFrp: number | null;
    lastAcqAt: string;
    bbox: [number, number, number, number];
  }
  const byMuni = new Map<number, Accum>();
  for (const h of hotspots) {
    const col = Math.floor((h.longitude - index.x0) / index.cell);
    const row = Math.floor((h.latitude - index.y0) / index.cell);
    if (col < 0 || col >= index.cols || row < 0 || row >= index.rows) continue;
    const id = index.grid[row * index.cols + col];
    if (id === 0) continue; // celda sin municipio (mar, hueco de simplificación)
    const entry =
      byMuni.get(id) ??
      ({
        count: 0,
        maxFrp: null,
        lastAcqAt: '',
        bbox: [Infinity, Infinity, -Infinity, -Infinity],
      } as Accum);
    entry.count += 1;
    if (h.frp !== null && (entry.maxFrp === null || h.frp > entry.maxFrp)) entry.maxFrp = h.frp;
    // ISO de ancho fijo: comparar strings equivale a comparar instantes.
    const acqAt = acqIso(h);
    if (acqAt > entry.lastAcqAt) entry.lastAcqAt = acqAt;
    // bbox de los focos del municipio: es adonde vuela el mapa al hacer clic.
    if (h.longitude < entry.bbox[0]) entry.bbox[0] = h.longitude;
    if (h.latitude < entry.bbox[1]) entry.bbox[1] = h.latitude;
    if (h.longitude > entry.bbox[2]) entry.bbox[2] = h.longitude;
    if (h.latitude > entry.bbox[3]) entry.bbox[3] = h.latitude;
    byMuni.set(id, entry);
  }

  const byRegion = new Map<number, MunicipalityImpact[]>();
  for (const [id, e] of byMuni) {
    if (e.count < MIN_HOTSPOTS_PER_MUNICIPALITY) continue;
    const muni = index.municipalities[id - 1];
    if (!muni || muni.r < 0) continue;
    const list = byRegion.get(muni.r) ?? [];
    list.push({ name: muni.n, count: e.count, maxFrp: e.maxFrp, lastAcqAt: e.lastAcqAt, bbox: e.bbox });
    byRegion.set(muni.r, list);
  }

  const result: RegionImpact[] = [];
  for (const [regionIdx, municipalities] of byRegion) {
    // Detección más reciente primero: cuenta la historia del fuego extendiéndose
    // a nuevas localidades. A igual instante (los satélites barren zonas enteras
    // a la vez), desempatan tamaño e intensidad.
    municipalities.sort(
      (a, b) =>
        b.lastAcqAt.localeCompare(a.lastAcqAt) ||
        b.count - a.count ||
        (b.maxFrp ?? 0) - (a.maxFrp ?? 0)
    );
    result.push({
      name: index.regions[regionIdx],
      count: municipalities.reduce((sum, m) => sum + m.count, 0),
      municipalities: municipalities.slice(0, MAX_MUNICIPALITIES_PER_REGION),
    });
  }
  return result.sort((a, b) => b.count - a.count);
}

/** "2026-07-24" + "1330" → "2026-07-24T13:30:00Z" (acqTime llega con cero inicial). */
function acqIso(h: FireHotspot): string {
  return `${h.acqDate}T${h.acqTime.slice(0, 2)}:${h.acqTime.slice(2)}:00Z`;
}
