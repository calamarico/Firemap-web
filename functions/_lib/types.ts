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
  ASSETS: Fetcher;
  // Cache global de la respuesta de /api/fires (opcional: sin el binding, la
  // app funciona solo con las caches por datacenter).
  FIRES_KV?: KVNamespace;
}
