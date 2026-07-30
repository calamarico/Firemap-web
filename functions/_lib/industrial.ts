/**
 * Fuentes de calor industriales persistentes (mismo dato y misma lógica que
 * server/src/industrial.ts): hornos, chimeneas y antorchas que los satélites
 * detectan casi a diario y que no son incendios. No hay una fuente de datos
 * fiable de estas instalaciones, así que la lista se cura a mano, y cada
 * entrada se verifica sobre imagen aérea antes de añadirla (el foco recae
 * sobre la planta, no sobre vegetación); un falso positivo aquí borraría
 * detecciones de un incendio real, que es el peor fallo posible del mapa.
 * El radio cubre el recinto más la deriva de geolocalización entre pasadas
 * (~375 m el píxel VIIRS).
 */

interface IndustrialHeatSource {
  name: string;
  lon: number;
  lat: number;
  radiusKm: number;
}

const INDUSTRIAL_HEAT_SOURCES: readonly IndustrialHeatSource[] = [
  { name: 'Cementera de Morata de Tajuña', lon: -3.4745, lat: 40.245, radiusKm: 0.9 },
  { name: 'Complejo petroquímico de Puertollano', lon: -4.055, lat: 38.672, radiusKm: 2 },
  { name: 'Cementera de Alcalá de Guadaíra', lon: -5.8655, lat: 37.36, radiusKm: 0.8 },
  { name: 'Cementera de Sant Vicenç dels Horts', lon: 1.999, lat: 41.407, radiusKm: 0.8 },
  { name: 'Siderúrgica de Castellbisbal', lon: 1.9805, lat: 41.4545, radiusKm: 0.8 },
];

const KM_PER_DEG_LAT = 111.32;
const D2R = Math.PI / 180;

/** Equirectangular basta: los radios son de cientos de metros, no de grados. */
export function isIndustrialHeatSource(lon: number, lat: number): boolean {
  for (const s of INDUSTRIAL_HEAT_SOURCES) {
    const dLat = (lat - s.lat) * KM_PER_DEG_LAT;
    const dLon = (lon - s.lon) * KM_PER_DEG_LAT * Math.cos(s.lat * D2R);
    if (dLat * dLat + dLon * dLon <= s.radiusKm * s.radiusKm) return true;
  }
  return false;
}
