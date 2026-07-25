import type { RegionImpact } from '../types';

/**
 * Celda de deduplicación: municipios pegados (una misma comarca ardiendo)
 * comparten flecha en vez de apilar tres casi idénticas.
 */
const DEDUPE_CELL_DEG = 0.25;

/**
 * Redondeo de la coordenada final (~5 km). El bbox de un municipio crece unos
 * metros con cada detección nueva; sin este redondeo la clave del hook de
 * viento cambiaría en cada refresco de focos y refetchearía sin motivo.
 */
const SNAP_DEG = 0.05;

const MAX_POINTS = 60;

/**
 * Puntos donde muestrear el viento junto a los focos: el centroide del bbox
 * de cada municipio del ranking de impacto (solo entran municipios con ≥2
 * focos, el filtro ya lo aplica el proxy). Devuelve un orden estable por
 * clave para que reordenaciones del ranking no alteren el resultado.
 */
export function deriveFireWindPoints(impact: RegionImpact[]): Array<[number, number]> {
  const byCell = new Map<string, { lon: number; lat: number; count: number }>();

  for (const region of impact) {
    for (const muni of region.municipalities) {
      const [minLon, minLat, maxLon, maxLat] = muni.bbox;
      const lon = (minLon + maxLon) / 2;
      const lat = (minLat + maxLat) / 2;
      const key = `${Math.round(lon / DEDUPE_CELL_DEG)}:${Math.round(lat / DEDUPE_CELL_DEG)}`;
      const current = byCell.get(key);
      // En colisión gana el municipio con más focos, conservando SU centroide
      // (no el centro de la celda): la flecha queda sobre el cluster real.
      if (!current || muni.count > current.count) {
        byCell.set(key, { lon, lat, count: muni.count });
      }
    }
  }

  // El segundo redondeo (2 decimales) evita colas binarias (40.150000000001)
  // en la URL y en la clave; los múltiplos de 0.05 son exactos a 2 decimales.
  const snap = (n: number) => Math.round(Math.round(n / SNAP_DEG) * SNAP_DEG * 100) / 100;
  return [...byCell.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_POINTS)
    .map(({ lon, lat }): [number, number] => [snap(lon), snap(lat)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
