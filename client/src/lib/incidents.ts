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

/** Distancia plana en km (suficiente a escala local; no es navegación). */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (aLat - bLat) * KM_PER_DEG_LAT;
  const dLon = (aLon - bLon) * KM_PER_DEG_LON_EQ * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

/** Etiquetas de procedencia SIEMPRE visibles: el dato es de quien lo publica.
 *  La de Portugal es además la atribución que exigen los términos de su API
 *  (junto al crédito enlazado del footer de la sidebar). */
export const INCIDENT_SOURCE_LABELS: Record<IncidentSource, string> = {
  'bombers-cat': 'Bombers Generalitat',
  jcyl: 'Junta de Castilla y León',
  'copernicus-ems': 'Copernicus EMS',
  'fogos-pt': 'Fogos.pt · Proteção Civil',
};

/**
 * El incidente más cercano (dentro de su radio) a un punto concreto — el foco
 * clicado en el popup, o el centroide de los focos de un municipio. Las
 * fuentes locales (fase + medios) tienen prioridad sobre la señal EMS, que
 * solo dice "emergencia europea activada en la zona".
 */
export function matchIncidentToPoint(
  lat: number,
  lon: number,
  incidents: OperationalIncident[]
): OperationalIncident | null {
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
  return best;
}

/** El incidente más cercano por slug de municipio del ranking. */
export function matchIncidents(
  impact: RegionImpact[],
  incidents: OperationalIncident[]
): Map<string, OperationalIncident> {
  const out = new Map<string, OperationalIncident>();
  if (incidents.length === 0) return out;
  for (const region of impact) {
    for (const muni of region.municipalities) {
      const [minLon, minLat, maxLon, maxLat] = muni.bbox;
      const best = matchIncidentToPoint((minLat + maxLat) / 2, (minLon + maxLon) / 2, incidents);
      if (best) out.set(muni.slug, best);
    }
  }
  return out;
}

/** "Oficial: activo · 43 operativos · 12 vehículos" o "Emergencia europea EMSR908 en la zona". */
export function incidentLine(incident: OperationalIncident): string {
  if (incident.source === 'copernicus-ems') {
    return `Emergencia europea ${incident.level ?? ''} en la zona`.trim();
  }
  const parts: string[] = [];
  if (incident.state) parts.push(`Oficial: ${incident.state}`);
  if (incident.level) parts.push(`IGR ${incident.level}`);
  const { personnel, vehicles, aerial } = incident.resources ?? {};
  if (personnel) parts.push(`${personnel} operativos`);
  if (vehicles) parts.push(`${vehicles} vehículos`);
  if (aerial) parts.push(`${aerial} ${aerial === 1 ? 'medio aéreo' : 'medios aéreos'}`);
  return parts.join(' · ');
}
