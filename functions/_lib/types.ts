// Contrato de la API del proxy en Cloudflare Pages Functions.
// Mantener en sincronía con server/src/types.ts y client/src/types.ts.

export interface FireHotspot {
  latitude: number;
  longitude: number;
  /** Fecha de adquisición YYYY-MM-DD (UTC). */
  acqDate: string;
  /** Hora de adquisición HHMM (UTC), con cero inicial garantizado. */
  acqTime: string;
  satellite: string;
  instrument: string;
  confidence: string;
  /** Fire Radiative Power (MW). */
  frp: number | null;
  /** Nº de pasadas satelitales que detectaron esta celda en la ventana de 24 h. */
  detections?: number;
  /** Primera detección de la celda en la ventana (ISO 8601 UTC): "arde desde". */
  firstAcqAt?: string;
  /** Municipio bajo el foco (rejilla de muni-grid), para el popup. */
  muniName?: string;
  /** Slug de la página /incendios/<slug> del municipio. */
  muniSlug?: string;
  /** Comunidad autónoma (o distrito, en Portugal) del municipio. */
  muniRegion?: string;
}

export interface MunicipalityImpact {
  name: string;
  /** Slug de la página /incendios/<slug> (único; desambiguado por región). */
  slug: string;
  count: number;
  maxFrp: number | null;
  /** Última detección en el municipio (ISO 8601 UTC): ordena el ranking. */
  lastAcqAt: string;
  /** Bounding box de LOS FOCOS del municipio [minLon, minLat, maxLon, maxLat]: el cliente vuela ahí. */
  bbox: [number, number, number, number];
}

export interface RegionImpact {
  name: string;
  count: number;
  /** Detección más reciente de la comunidad (ISO 8601 UTC): la edad se muestra aquí. */
  lastAcqAt: string;
  municipalities: MunicipalityImpact[];
}

export interface FiresResponse {
  count: number;
  windowHours: number;
  sensors: string[];
  partial: boolean;
  fetchedAt: string;
  cached: boolean;
  hotspots: FireHotspot[];
  impact: RegionImpact[];
}

export type EffisRange = '7d' | '30d' | 'season';

export interface EffisStatus {
  available: boolean;
  endpoint?: string;
  layer?: string;
  layerTitle?: string;
  supportsTime: boolean;
  checkedAt: string;
  note?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

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

/** Bindings del proyecto Pages: secreto de FIRMS + estáticos del propio deploy. */
export interface Env {
  FIRMS_MAP_KEY?: string;
  /** Token de api.fogos.pt (header X-API-Key). Sin él, la fuente PT del
   *  agregador de incidentes simplemente no se consulta. */
  FOGOS_API_KEY?: string;
  /** Base D1 de la app (feedback; futuras alertas push). Opcional: sin el
   *  binding, /api/feedback responde 503 y la card degrada sin romper. */
  APP_DB?: D1Database;
  ASSETS: Fetcher;
  // Cache global de la respuesta de /api/fires (opcional: sin el binding, la
  // app funciona solo con las caches por datacenter).
  FIRES_KV?: KVNamespace;
}
