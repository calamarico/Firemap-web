/**
 * Vista inicial: península ibérica completa, con Portugal (Canarias queda
 * fuera del encuadre inicial pero sus focos se cargan igual; basta desplazar
 * el mapa).
 */
export const MAP_CENTER: [number, number] = [-5.2, 40.0];
export const INITIAL_ZOOM = 5.2;

/** Auto-refresco de datos (coincide con la ventana de frescura del proxy). */
export const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Cooldown del botón "Refrescar ahora": cada pulsación es una invocación de
 * Pages Functions (cuenta contra las 100k/día del plan free), así que se
 * impide repetir hasta pasado este margen.
 */
export const MANUAL_REFRESH_COOLDOWN_MS = 30 * 1000;

/**
 * Refresco del viento (Open-Meteo, directo desde el navegador — no pasa por
 * el proxy). Su dato "current" se actualiza cada ~15 min: pedir más a menudo
 * solo devolvería lo mismo. Si la llamada falla se reintenta antes.
 */
export const WIND_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
export const WIND_RETRY_MS = 2 * 60 * 1000;

/**
 * Refresco del campo de flujo de viento (Open-Meteo, solo con la capa
 * activa). Media hora y no un cuarto: Open-Meteo actualiza su "current" cada
 * ~15 min, pero el flujo sinóptico no cambia de forma perceptible en ese rato
 * y esto parte el coste por dos.
 */
export const WIND_FIELD_REFRESH_INTERVAL_MS = 30 * 60_000;

// La escala de severidad FRP y los colores del mapa viven en
// styles/mapTokens.ts, la fuente única compartida por capas y leyenda.
