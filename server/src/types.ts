// Contrato de la API del proxy.
// Mantener en sincronía con client/src/types.ts (el frontend consume estas formas).

/**
 * Un foco de calor detectado por satélite (API de área de NASA FIRMS).
 * Solo los campos que la UI consume: el CSV trae más (brightness, scan,
 * track, version, daynight) pero emitirlos duplicaría el peso del payload
 * sin que nadie los lea.
 */
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
  /** Última detección en el municipio (ISO 8601 UTC): ordena el ranking. */
  lastAcqAt: string;
  /** Bounding box de LOS FOCOS del municipio [minLon, minLat, maxLon, maxLat]: el cliente vuela ahí. */
  bbox: [number, number, number, number];
}

export interface RegionImpact {
  /** Comunidad autónoma. */
  name: string;
  count: number;
  /** Detección más reciente de la comunidad (ISO 8601 UTC): la edad se muestra aquí. */
  lastAcqAt: string;
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
  /** Cuándo se descargó de FIRMS (ISO). Puede ser anterior a la petición si viene de cache. */
  fetchedAt: string;
  cached: boolean;
  hotspots: FireHotspot[];
  /** Ranking de localidades afectadas, agrupado por comunidad autónoma. */
  impact: RegionImpact[];
}

export type EffisRange = '7d' | '30d' | 'season';

export interface EffisStatus {
  available: boolean;
  /** Base WMS que respondió a la sonda (solo si available). */
  endpoint?: string;
  /** Nombre exacto de la capa WMS activa (confirmado vía sonda GetMap). */
  layer?: string;
  layerTitle?: string;
  /**
   * Si es false, la capa activa no admite el parámetro WMS TIME: el selector
   * de rango (7d/30d/temporada) no aplica y el frontend debe deshabilitarlo.
   */
  supportsTime: boolean;
  checkedAt: string;
  note?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

/** Error de negocio que el middleware traduce a una respuesta JSON tipada. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
