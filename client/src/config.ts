/**
 * Vista inicial: península completa (Canarias queda fuera del encuadre
 * inicial pero sus focos se cargan igual; basta desplazar el mapa).
 */
export const MAP_CENTER: [number, number] = [-3.9, 40.1];
export const INITIAL_ZOOM = 5.5;

/** Auto-refresco de datos (coincide con la ventana de frescura del proxy). */
export const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Cooldown del botón "Refrescar ahora": cada pulsación es una invocación de
 * Pages Functions (cuenta contra las 100k/día del plan free), así que se
 * impide repetir hasta pasado este margen.
 */
export const MANUAL_REFRESH_COOLDOWN_MS = 30 * 1000;

/** Escala de color por FRP (MW). Compartida por la capa de círculos y la leyenda. */
export const FRP_SCALE: ReadonlyArray<{ upTo: number | null; color: string; label: string }> = [
  { upTo: 5, color: '#facc15', label: '< 5 MW' },
  { upTo: 20, color: '#fb923c', label: '5 – 20 MW' },
  { upTo: 50, color: '#ef4444', label: '20 – 50 MW' },
  { upTo: null, color: '#7f1d1d', label: '> 50 MW' },
];

export const EFFIS_SWATCH_COLOR = '#9a3412';
