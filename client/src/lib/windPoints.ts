import type { FireHotspot, RegionImpact } from '../types';

/**
 * Celda de deduplicación: municipios pegados (una misma comarca ardiendo)
 * comparten pluma en vez de apilar tres casi idénticas.
 */
const DEDUPE_CELL_DEG = 0.25;

/**
 * Redondeo de la coordenada de muestreo (~5 km). El bbox de un municipio
 * crece unos metros con cada detección nueva; sin este redondeo la clave del
 * hook de viento cambiaría en cada refresco de focos y refetchearía sin
 * motivo.
 */
const SNAP_DEG = 0.05;

const MAX_POINTS = 60;

export interface FireWindSite {
  /**
   * Punto de muestreo del viento (centroide del bbox, redondeado): es la
   * clave estable del fetch y lo que se manda a Open-Meteo. El viento no
   * varía de forma útil en los ~5 km que lo separan del anchor.
   */
  sample: [number, number];
  /**
   * Círculo de foco al que se ancla la pluma al dibujarla: el humo nace de
   * un fuego real, no del centroide administrativo (que puede caer en medio
   * de la nada). Es el foco con más FRP del municipio ganador de la celda.
   * Puede cambiar con cada refresco de focos sin tocar `sample`: mover el
   * vértice es gratis, refetchear viento no.
   */
  anchor: [number, number];
}

/**
 * Sitios de viento junto a los focos: por cada cluster, dónde muestrear
 * (centroide estable) y dónde dibujar la pluma (foco real). Solo entran
 * municipios con ≥2 focos o un foco confirmado por ≥2 pasadas; el filtro ya
 * lo aplica el proxy. Devuelve un orden estable por muestra para que
 * reordenaciones del ranking no alteren la clave del fetch.
 */
export function deriveFireWindSites(
  impact: RegionImpact[],
  hotspots: FireHotspot[]
): FireWindSite[] {
  const byCell = new Map<
    string,
    { lon: number; lat: number; count: number; bbox: [number, number, number, number] }
  >();

  for (const region of impact) {
    for (const muni of region.municipalities) {
      const [minLon, minLat, maxLon, maxLat] = muni.bbox;
      const lon = (minLon + maxLon) / 2;
      const lat = (minLat + maxLat) / 2;
      const key = `${Math.round(lon / DEDUPE_CELL_DEG)}:${Math.round(lat / DEDUPE_CELL_DEG)}`;
      const current = byCell.get(key);
      // En colisión gana el municipio con más focos, conservando SU centroide
      // (no el centro de la celda): la pluma queda sobre el cluster real.
      if (!current || muni.count > current.count) {
        byCell.set(key, { lon, lat, count: muni.count, bbox: muni.bbox });
      }
    }
  }

  // El segundo redondeo (2 decimales) evita colas binarias (40.150000000001)
  // en la URL y en la clave; los múltiplos de 0.05 son exactos a 2 decimales.
  const snap = (n: number) => Math.round(Math.round(n / SNAP_DEG) * SNAP_DEG * 100) / 100;

  return [...byCell.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_POINTS)
    .map(({ lon, lat, bbox }): FireWindSite => {
      const sample: [number, number] = [snap(lon), snap(lat)];
      // Ancla: el foco con más FRP dentro del bbox del municipio ganador.
      // Si no aparece ninguno (impact y hotspots pueden venir de refrescos
      // distintos), la pluma se dibuja en el propio punto de muestreo.
      const [minLon, minLat, maxLon, maxLat] = bbox;
      let anchor = sample;
      let bestFrp = -1;
      for (const h of hotspots) {
        if (h.longitude < minLon || h.longitude > maxLon) continue;
        if (h.latitude < minLat || h.latitude > maxLat) continue;
        const frp = h.frp ?? 0;
        if (frp > bestFrp) {
          bestFrp = frp;
          anchor = [h.longitude, h.latitude];
        }
      }
      return { sample, anchor };
    })
    .sort((a, b) => a.sample[0] - b.sample[0] || a.sample[1] - b.sample[1]);
}
