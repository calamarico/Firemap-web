// Contrato de la API del proxy.
// Mantener en sincronía con server/src/types.ts (fuente de los datos).

/** Un foco de calor detectado por satélite (API de área de NASA FIRMS). */
export interface FireHotspot {
  latitude: number;
  longitude: number;
  /** Fecha de adquisición YYYY-MM-DD (UTC). */
  acqDate: string;
  /** Hora de adquisición HHMM (UTC), con cero inicial garantizado. */
  acqTime: string;
  satellite: string;
  instrument: string;
  /** VIIRS: 'l' | 'n' | 'h' (baja/nominal/alta). MODIS: 0-100. */
  confidence: string;
  /** Fire Radiative Power (MW). */
  frp: number | null;
}

/** Un municipio con focos dentro, para el ranking de zonas afectadas. */
export interface MunicipalityImpact {
  name: string;
  count: number;
  maxFrp: number | null;
  /** Bounding box de los focos del municipio [minLon, minLat, maxLon, maxLat]. */
  bbox: [number, number, number, number];
}

export interface RegionImpact {
  /** Comunidad autónoma. */
  name: string;
  count: number;
  municipalities: MunicipalityImpact[];
}

export interface FiresResponse {
  count: number;
  /** Ventana móvil de la vista "momento actual" (horas hacia atrás desde ahora). */
  windowHours: number;
  /** Sensores fusionados en esta respuesta. */
  sensors: string[];
  /** true si algún sensor no respondió y la respuesta es incompleta. */
  partial: boolean;
  /** Cuándo se descargó de FIRMS (ISO). Puede venir de la cache del proxy. */
  fetchedAt: string;
  cached: boolean;
  hotspots: FireHotspot[];
  /** Ranking de localidades afectadas, agrupado por comunidad autónoma. */
  impact: RegionImpact[];
}

export type EffisRange = '7d' | '30d' | 'season';

export interface EffisStatus {
  available: boolean;
  endpoint?: string;
  layer?: string;
  layerTitle?: string;
  /** Si es false, la capa activa no admite rango temporal (deshabilitar selector). */
  supportsTime: boolean;
  checkedAt: string;
  note?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ApiErrorBody).error?.message === 'string'
  );
}
