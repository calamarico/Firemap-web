import type { IncidentSource, OperationalIncident, RegionImpact } from '../types';

/**
 * Cruce de los incidentes oficiales (/api/incidents) con el ranking de
 * municipios afectados (detecciones satelitales): un incidente describe al
 * municipio si su punto cae cerca del centroide de los focos. Radios
 * distintos por naturaleza de la fuente — un parte de Bombers/JCyL es local;
 * una activación de Copernicus EMS cubre una comarca entera.
 */
const LOCAL_RADIUS_KM = 10;
const EMS_RADIUS_KM = 60;

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQ = 111.32;

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (aLat - bLat) * KM_PER_DEG_LAT;
  const dLon = (aLon - bLon) * KM_PER_DEG_LON_EQ * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

/** Etiquetas de procedencia SIEMPRE visibles: el dato es de quien lo publica. */
export const INCIDENT_SOURCE_LABELS: Record<IncidentSource, string> = {
  'bombers-cat': 'Bombers Generalitat',
  jcyl: 'Junta de Castilla y León',
  'copernicus-ems': 'Copernicus EMS',
};

/**
 * El incidente más cercano (dentro de su radio) por slug de municipio del
 * ranking. Las fuentes locales (fase + medios) tienen prioridad sobre la
 * señal EMS, que solo dice "emergencia europea activada en la zona".
 */
export function matchIncidents(
  impact: RegionImpact[],
  incidents: OperationalIncident[]
): Map<string, OperationalIncident> {
  const out = new Map<string, OperationalIncident>();
  if (incidents.length === 0) return out;
  for (const region of impact) {
    for (const muni of region.municipalities) {
      const [minLon, minLat, maxLon, maxLat] = muni.bbox;
      const lat = (minLat + maxLat) / 2;
      const lon = (minLon + maxLon) / 2;
      let best: OperationalIncident | null = null;
      let bestScore = Infinity;
      for (const incident of incidents) {
        const radius = incident.source === 'copernicus-ems' ? EMS_RADIUS_KM : LOCAL_RADIUS_KM;
        const d = distanceKm(lat, lon, incident.lat, incident.lon);
        if (d > radius) continue;
        // Prioridad a las fuentes locales: una EMS solo gana si no hay otra.
        const score = incident.source === 'copernicus-ems' ? d + 1000 : d;
        if (score < bestScore) {
          bestScore = score;
          best = incident;
        }
      }
      if (best) out.set(muni.slug, best);
    }
  }
  return out;
}
