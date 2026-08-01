import fs from 'node:fs';
import path from 'node:path';
import { pointInPreparedRings, PreparedRings, prepareRings, Ring } from './geo';
import { FireHotspot, MunicipalityImpact, RegionImpact } from './types';

/**
 * Ranking de localidades afectadas: join espacial de cada foco contra los
 * polígonos de municipios y comunidades autónomas (geoBoundaries, en
 * server/data/). Se hace en el proxy y viaja ya agregado: el cliente no
 * necesita cargar ni un polígono para pintar la lista.
 *
 * Los ficheros se leen en runtime (no via import) para que tsc no tenga que
 * tragarse 7,5 MB de JSON en cada typecheck; viven fuera de src/ y valen
 * igual en dev (tsx) y en producción (dist/).
 */

interface IndexedArea {
  name: string;
  polygons: PreparedRings[];
}

// Desde src/ (dev con tsx) y desde dist/ (producción) es el mismo salto:
// server/data/, fuera de src para que tsc no procese estos JSON enormes.
const DATA_DIR = path.resolve(__dirname, '..', 'data');

let municipalities: IndexedArea[] | null = null;
let regions: IndexedArea[] | null = null;
// Slugs base que aparecen más de una vez: esos municipios llevan sufijo de
// región en su slug. Mismo algoritmo que scripts/build-muni-index.mjs (que es
// la fuente de verdad para el despliegue Cloudflare): ambos derivan de los
// mismos nombres de municipios.json, así que el resultado es idéntico.
let duplicatedSlugBases: Set<string> | null = null;
let loadFailed = false;

/** Idéntico al slugify de scripts/build-muni-index.mjs. */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function muniSlug(name: string, region: string): string {
  const base = slugify(name);
  return duplicatedSlugBases?.has(base) ? `${base}-${slugify(region)}` : base;
}

function loadAreas(file: string): IndexedArea[] {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')) as {
    features: Array<{
      properties: { name: string };
      geometry: { type: string; coordinates: unknown };
    }>;
  };
  return raw.features.map((f) => {
    const coords = f.geometry.coordinates;
    const polys: Ring[][] =
      f.geometry.type === 'Polygon' ? [coords as Ring[]] : (coords as Ring[][]);
    return { name: f.properties.name, polygons: polys.map(prepareRings) };
  });
}

function ensureLoaded(): boolean {
  if (municipalities && regions) return true;
  if (loadFailed) return false;
  try {
    municipalities = loadAreas('municipios.json');
    regions = loadAreas('ccaa.json');
    const counts = new Map<string, number>();
    for (const m of municipalities) {
      const base = slugify(m.name);
      counts.set(base, (counts.get(base) ?? 0) + 1);
    }
    duplicatedSlugBases = new Set([...counts].filter(([, n]) => n > 1).map(([base]) => base));
    return true;
  } catch (err) {
    // Sin polígonos no hay ranking, pero la app sigue: el campo impact irá vacío.
    loadFailed = true;
    console.error('No se pudieron cargar los polígonos para el ranking de localidades:', err);
    return false;
  }
}

function findArea(areas: IndexedArea[], lon: number, lat: number): string | null {
  for (const area of areas) {
    for (const polygon of area.polygons) {
      if (pointInPreparedRings(lon, lat, polygon)) return area.name;
    }
  }
  return null;
}

const MAX_MUNICIPALITIES_PER_REGION = 12;
// Un único foco suele ser ruido (quema agrícola, industria, falso positivo):
// solo entran en el ranking los municipios con al menos 2 detecciones.
// OJO: tras dedupeHotspots `count` cuenta celdas de la última pasada, no
// detecciones — un fuego pequeño pero persistente queda en 1 foco con
// `detections` ≥ 2. El umbral se cumple por extensión (≥ 2 celdas) O por
// confirmación (≥ 2 pasadas sobre la misma celda); si no, la dedupe vaciaba
// del ranking (y de las plumas de viento) municipios con fuego real.
const MIN_HOTSPOTS_PER_MUNICIPALITY = 2;

/**
 * Además del ranking, ANOTA en cada hotspot su municipio (muniName/muniSlug/
 * muniRegion), en paridad con functions/_lib/impact.ts: el popup del foco lo
 * enseña y enlaza /incendios/<slug>. Se hace aquí de paso porque el join
 * espacial por foco (ray-casting, caro) ya está hecho en este bucle.
 */
export function computeImpact(hotspots: FireHotspot[]): RegionImpact[] {
  if (!ensureLoaded() || !municipalities || !regions) return [];

  interface Accum {
    count: number;
    maxDetections: number;
    maxFrp: number | null;
    lastAcqAt: string;
    bbox: [number, number, number, number];
  }
  // region → municipio → acumulado
  const byRegion = new Map<string, Map<string, Accum>>();
  for (const h of hotspots) {
    const region = findArea(regions, h.longitude, h.latitude);
    const municipality = region && findArea(municipalities, h.longitude, h.latitude);
    // Un foco puede caer en un hueco entre polígonos simplificados: se omite
    // del ranking (sigue contando en el total del mapa).
    if (!region || !municipality) continue;
    h.muniName = municipality;
    h.muniSlug = muniSlug(municipality, region);
    h.muniRegion = region;

    let munis = byRegion.get(region);
    if (!munis) byRegion.set(region, (munis = new Map()));
    const entry =
      munis.get(municipality) ??
      ({
        count: 0,
        maxDetections: 0,
        maxFrp: null,
        lastAcqAt: '',
        bbox: [Infinity, Infinity, -Infinity, -Infinity],
      } as Accum);
    entry.count += 1;
    if ((h.detections ?? 1) > entry.maxDetections) entry.maxDetections = h.detections ?? 1;
    if (h.frp !== null && (entry.maxFrp === null || h.frp > entry.maxFrp)) entry.maxFrp = h.frp;
    // ISO de ancho fijo: comparar strings equivale a comparar instantes.
    const acqAt = acqIso(h);
    if (acqAt > entry.lastAcqAt) entry.lastAcqAt = acqAt;
    // bbox de los focos del municipio: es adonde vuela el mapa al hacer clic.
    if (h.longitude < entry.bbox[0]) entry.bbox[0] = h.longitude;
    if (h.latitude < entry.bbox[1]) entry.bbox[1] = h.latitude;
    if (h.longitude > entry.bbox[2]) entry.bbox[2] = h.longitude;
    if (h.latitude > entry.bbox[3]) entry.bbox[3] = h.latitude;
    munis.set(municipality, entry);
  }

  const result: RegionImpact[] = [];
  for (const [region, munis] of byRegion) {
    const relevant: MunicipalityImpact[] = [...munis.entries()]
      .filter(
        ([, e]) =>
          e.count >= MIN_HOTSPOTS_PER_MUNICIPALITY ||
          e.maxDetections >= MIN_HOTSPOTS_PER_MUNICIPALITY
      )
      .map(([name, e]) => ({
        name,
        slug: muniSlug(name, region),
        count: e.count,
        maxFrp: e.maxFrp,
        lastAcqAt: e.lastAcqAt,
        bbox: e.bbox,
      }))
      // Detección más reciente primero: cuenta la historia del fuego
      // extendiéndose a nuevas localidades. A igual instante (los satélites
      // barren zonas enteras a la vez), desempatan tamaño e intensidad.
      .sort(
        (a, b) =>
          b.lastAcqAt.localeCompare(a.lastAcqAt) ||
          b.count - a.count ||
          (b.maxFrp ?? 0) - (a.maxFrp ?? 0)
      );
    if (relevant.length === 0) continue;
    result.push({
      name: region,
      // El total regional cuenta solo los municipios que entran en el ranking,
      // para que cuadre con lo que la lista muestra.
      count: relevant.reduce((sum, m) => sum + m.count, 0),
      // Ya ordenados por fecha descendente: el primero es el más reciente.
      lastAcqAt: relevant[0].lastAcqAt,
      municipalities: relevant.slice(0, MAX_MUNICIPALITIES_PER_REGION),
    });
  }
  return result.sort((a, b) => b.count - a.count);
}

/** "2026-07-24" + "1330" → "2026-07-24T13:30:00Z" (acqTime llega con cero inicial). */
function acqIso(h: FireHotspot): string {
  return `${h.acqDate}T${h.acqTime.slice(0, 2)}:${h.acqTime.slice(2)}:00Z`;
}
