/**
 * Modo embebido (/embed): el mismo mapa sin panel lateral, pensado para vivir
 * dentro de un <iframe> en otra web (medios, ayuntamientos, blogs). Es una
 * entrada propia de Vite (client/embed.html → src/embed.tsx), no una ruta de la
 * SPA: así el widget no arrastra el bundle de la sidebar ni el marcado SEO de la
 * home, y puede llevar su propio <meta name="robots" content="noindex">.
 *
 * Este módulo es el contrato de la URL del embed y lo comparten las DOS puntas:
 * el generador de código (/insertar → EmbedBuilder) y el parser que lee la
 * configuración al arrancar. Si divergieran, el snippet que copia un periodista
 * pintaría otra cosa distinta de la que vio en la previsualización.
 */
import type { BasemapId } from '../map/layers';

/** Dominio canónico: los snippets que se copian deben apuntar siempre aquí. */
export const SITE_ORIGIN = 'https://firemapsspain.online';

export const EMBED_PATH = '/embed';

export interface EmbedConfig {
  showFires: boolean;
  showEffis: boolean;
  showWind: boolean;
  showWindField: boolean;
  showBoundaries: boolean;
  basemap: BasemapId;
  /** Vista inicial explícita; sin ella manda `locality`, y si no, la de config.ts. */
  center: [number, number] | null;
  zoom: number | null;
  /** Slug (/incendios/<slug>) o nombre de municipio al que volar al cargar. */
  locality: string | null;
  /** Fila de chips de capa sobre el mapa. */
  controls: boolean;
  /** Leyenda compacta abajo a la izquierda. */
  legend: boolean;
  /** Ranking de localidades afectadas (solo cabe en iframes anchos). */
  ranking: boolean;
}

/**
 * Defaults del widget. Difieren de la app en una cosa a propósito: el flujo de
 * viento arranca APAGADO. Es animación continua (batería y CPU de una pestaña
 * que el lector ni ha mirado) y cuesta 109,2 llamadas ponderadas de Open-Meteo
 * por refresco, desproporcionado para un mapa de 400 px dentro de un artículo.
 * Quien lo quiera lo pide con `capas=...,flujo`.
 */
export const EMBED_DEFAULTS: EmbedConfig = {
  showFires: true,
  showEffis: true,
  showWind: true,
  showWindField: false,
  showBoundaries: true,
  basemap: 'satellite',
  center: null,
  zoom: null,
  locality: null,
  controls: true,
  legend: true,
  ranking: false,
};

/** Nombres públicos de las capas en `?capas=` (castellano, como `?localidad=`). */
const LAYER_KEYS = {
  focos: 'showFires',
  quemado: 'showEffis',
  viento: 'showWind',
  flujo: 'showWindField',
  limites: 'showBoundaries',
} as const satisfies Record<string, keyof EmbedConfig>;

export type EmbedLayerKey = keyof typeof LAYER_KEYS;

export const EMBED_LAYERS: ReadonlyArray<{ key: EmbedLayerKey; label: string; swatch?: string }> = [
  { key: 'focos', label: 'Focos de calor', swatch: 'var(--fm-severity-3)' },
  { key: 'quemado', label: 'Área quemada', swatch: 'var(--fm-burnt-fill)' },
  { key: 'viento', label: 'Viento junto a los incendios', swatch: 'var(--fm-map-smoke-band-1)' },
  { key: 'flujo', label: 'Flujo de viento', swatch: 'var(--fm-map-flow-trail)' },
  { key: 'limites', label: 'Límites administrativos' },
];

const BASEMAP_PARAM: Record<string, BasemapId> = { satelite: 'satellite', oscuro: 'dark' };

/** Configuración a partir de la query del iframe (`?capas=…&base=…`). */
export function parseEmbedConfig(search: string): EmbedConfig {
  const params = new URLSearchParams(search);
  const config: EmbedConfig = { ...EMBED_DEFAULTS };

  // `capas` presente = lista completa: lo que no aparece queda apagado. Así el
  // snippet describe el estado entero y no depende de defaults futuros.
  const capas = params.get('capas');
  if (capas !== null) {
    const wanted = new Set(capas.split(',').map((s) => s.trim().toLowerCase()));
    for (const [param, field] of Object.entries(LAYER_KEYS)) {
      config[field] = wanted.has(param);
    }
  }

  const base = params.get('base');
  if (base && BASEMAP_PARAM[base]) config.basemap = BASEMAP_PARAM[base];

  const centro = params.get('centro');
  if (centro) {
    // Orden lat,lon: es el que la gente copia de Google Maps (el interno de
    // MapLibre es lon,lat, y se traduce aquí y solo aquí).
    const [lat, lon] = centro.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90) {
      config.center = [lon, lat];
    }
  }

  const zoom = Number(params.get('zoom'));
  if (Number.isFinite(zoom) && zoom >= 5 && zoom <= 17) config.zoom = zoom;

  const locality = params.get('localidad');
  if (locality) config.locality = locality;

  if (params.get('controles') === '0') config.controls = false;
  if (params.get('leyenda') === '0') config.legend = false;
  if (params.get('ranking') === '1') config.ranking = true;

  return config;
}

/**
 * URL del iframe para una configuración. Solo escribe lo que se aparta de los
 * defaults: el snippet más común queda en `https://…/embed` a secas.
 */
export function buildEmbedUrl(config: EmbedConfig, origin: string = SITE_ORIGIN): string {
  const params = new URLSearchParams();

  const layersDiffer = Object.values(LAYER_KEYS).some(
    (field) => config[field] !== EMBED_DEFAULTS[field]
  );
  if (layersDiffer) {
    const active = (Object.keys(LAYER_KEYS) as EmbedLayerKey[]).filter(
      (key) => config[LAYER_KEYS[key]]
    );
    // Sin ninguna capa el widget sería un mapa base a secas, pero es una
    // elección legítima (p. ej. solo límites): se emite `capas=` vacío.
    params.set('capas', active.join(','));
  }
  if (config.basemap !== EMBED_DEFAULTS.basemap) params.set('base', 'oscuro');
  if (config.locality) params.set('localidad', config.locality);
  if (config.center) {
    params.set('centro', `${config.center[1].toFixed(4)},${config.center[0].toFixed(4)}`);
  }
  if (config.zoom !== null) params.set('zoom', String(Math.round(config.zoom * 10) / 10));
  if (!config.controls) params.set('controles', '0');
  if (!config.legend) params.set('leyenda', '0');
  if (config.ranking) params.set('ranking', '1');

  const query = params.toString();
  return `${origin}${EMBED_PATH}${query ? `?${query}` : ''}`;
}

/**
 * Enlace "ver el mapa completo" que abre el iframe en una pestaña nueva. Lleva
 * la vista actual en el hash (#map=zoom/lat/lon, el formato que ya entiende
 * MapView) y utm_source para que quien inserta el mapa vea en su analítica de
 * dónde le llega el tráfico.
 */
export function fullMapUrl(
  slug: string | null,
  view: { center: [number, number]; zoom: number } | null
): string {
  const path = slug ? `/incendios/${slug}` : '/';
  const hash = view
    ? `#map=${view.zoom.toFixed(2)}/${view.center[1].toFixed(4)}/${view.center[0].toFixed(4)}`
    : '';
  return `${SITE_ORIGIN}${path}?utm_source=embed&utm_medium=iframe${hash}`;
}
