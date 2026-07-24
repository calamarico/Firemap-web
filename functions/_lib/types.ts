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
  count: number;
  maxFrp: number | null;
}

export interface RegionImpact {
  name: string;
  count: number;
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
}
