/**
 * Enlaces para compartir el mapa (menú «Compartir» de la barra lateral). Toda la
 * construcción de URLs vive aquí, fuera del componente.
 *
 * El vocabulario de capas NO se define en este módulo: se importa de embed.ts,
 * que es el contrato público de `?capas=`. Si hubiera dos tablas, un enlace
 * compartido podría pintar capas distintas de las que veía quien lo copió.
 */
import { LAYER_KEYS, SITE_ORIGIN, type EmbedLayerKey, type LayerState } from './embed';

/**
 * Estado por defecto de las capas en la app (App.tsx): las cinco encendidas.
 * `capas=` solo se escribe cuando el estado se aparta de esto, igual que hace
 * buildEmbedUrl con los defaults del widget: el enlace más común queda limpio.
 */
const APP_DEFAULTS: LayerState = {
  showFires: true,
  showEffis: true,
  showWind: true,
  showWindField: true,
  showBoundaries: true,
};

const layerParams = () => Object.keys(LAYER_KEYS) as EmbedLayerKey[];

/**
 * Enlace de la vista actual: mismo origen y misma ruta (que ya puede ser
 * /incendios/<slug>) + el hash de vista que mantiene MapView + las capas
 * activas. La vista NO se recalcula: se lee el hash tal cual está.
 *
 * La query se reconstruye desde cero a propósito. Lo que hay en la URL al
 * compartir puede ser el `?localidad=` legacy (que la app ya está migrando al
 * path) o el `utm_source=embed` con el que llegó el visitante desde un iframe
 * ajeno: heredarlos atribuiría al embed un enlace que ya no viene de ahí.
 */
export function viewShareUrl(layers: LayerState): string {
  const url = new URL(window.location.href);
  url.search = '';

  const differs = layerParams().some(
    (key) => layers[LAYER_KEYS[key]] !== APP_DEFAULTS[LAYER_KEYS[key]]
  );
  if (differs) {
    url.searchParams.set(
      'capas',
      layerParams()
        .filter((key) => layers[LAYER_KEYS[key]])
        .join(',')
    );
  }
  // La coma es legal sin escapar en una query (RFC 3986, sub-delims) y este
  // enlace lo pega una persona en un WhatsApp: `capas=focos,viento` se lee,
  // `capas=focos%2Cviento` no.
  return url.toString().replace(/%2C/g, ',');
}

/**
 * Enlace de una localidad: su página, sin hash. El destino es la localidad, no
 * el encuadre concreto de quien comparte.
 */
export function localityShareUrl(slug: string): string {
  return `${SITE_ORIGIN}/incendios/${slug}`;
}

/**
 * Lee `?capas=` al arrancar la app. Presente = lista completa: lo que no
 * aparece, apagado (idéntico al contrato del widget). Ausente = null, y manda el
 * estado por defecto.
 *
 * `reducedMotion` no es opcional: el flujo de viento es solo animación, así que
 * un enlace no puede encenderlo en un sistema que ha pedido no tener movimiento.
 */
export function parseLayersParam(search: string, reducedMotion: boolean): LayerState | null {
  const capas = new URLSearchParams(search).get('capas');
  if (capas === null) return null;

  const wanted = new Set(capas.split(',').map((value) => value.trim().toLowerCase()));
  const state = { ...APP_DEFAULTS };
  for (const key of layerParams()) {
    state[LAYER_KEYS[key]] = wanted.has(key);
  }
  if (reducedMotion) state.showWindField = false;
  return state;
}
