// Única fuente de verdad de los colores que consume MapLibre.
// Las expresiones de paint no aceptan var(), así que estos valores son
// literales; deben mantenerse alineados con tokens.css (criterio de
// aceptación 5 del design system).

export const SEVERITY = [
  { level: 1, upTo: 5, color: '#ffd449', label: 'Baja', range: '< 5 MW' },
  { level: 2, upTo: 20, color: '#ff9b21', label: 'Moderada', range: '5 – 20 MW' },
  { level: 3, upTo: 50, color: '#ff5a2d', label: 'Alta', range: '20 – 50 MW' },
  { level: 4, upTo: null, color: '#e8232a', label: 'Extrema', range: '> 50 MW' },
] as const;

export type SeverityLevel = (typeof SEVERITY)[number]['level'];

export const MAP = {
  void: '#0b1420',
  burntFill: '#8c3a1e',
  severityStroke: 'rgba(255,255,255,0.85)',
  boundaryCcaa: 'rgba(226,232,240,0.55)',
  boundaryProv: 'rgba(226,232,240,0.35)',
  boundaryMuni: 'rgba(226,232,240,0.22)',
  cityDot: 'rgba(226,232,240,0.90)',
  cityDotStroke: 'rgba(15,23,42,0.70)',
  label: '#ffffff',
  labelHalo: '#000000',
  // Viento: pluma de humo. Toda la familia es cian —inconfundible con la banda
  // ámbar/roja reservada a la severidad FRP—. Las tres bandas del cono son
  // 15 min de recorrido cada una; el alfa decreciente ES la dispersión.
  // Alfas recalibrados contra la imagen satelital real: con los originales
  // (0,18 y 0,08) las bandas 2 y 3 no se veían sobre terreno claro.
  smokeBand1: 'rgba(127,221,242,0.45)',
  smokeBand2: 'rgba(127,221,242,0.30)',
  smokeBand3: 'rgba(127,221,242,0.16)',
  smokeEdge: 'rgba(127,221,242,0.30)',
  smokeWisp: '#b3ecfa',
  windChevron: '#38c7e6',
  windLabel: '#38c7e6',
  // Flujo de viento ambiental. Neutro a propósito: el cian está reservado al
  // humo de los focos, y un campo cian se leería como humo inexistente.
  flowTrail: 'rgba(226,232,240,0.42)',
} as const;

/** Las claves de MAP con valores de color libres (MAP es `as const`: sus
 *  literales no admitirían la variante clara). */
export type MapPalette = Record<keyof typeof MAP, string>;
export type MapTheme = 'dark' | 'light';

/**
 * Variante para el mapa base claro (CARTO Positron), que usa el widget
 * embebible con `?tema=claro`. Solo las claves que cambian: todo lo que sobre
 * fondo claro sigue funcionando —la rampa de severidad, el marrón del área
 * quemada— se hereda de MAP.
 *
 * El criterio es el mismo que costó dos iteraciones en la pluma de humo: lo que
 * era claro-translúcido sobre terreno oscuro desaparece sobre Positron (que es
 * casi blanco). Por eso aquí los límites y el flujo pasan a slate oscuro y el
 * humo baja del cian claro (#7fddf2) al cian medio (#12a9cc): mismo significado,
 * contraste invertido. Gemelo del bloque [data-tema='claro'] de tokens.css.
 */
export const MAP_LIGHT: Partial<MapPalette> = {
  void: '#dbe4e6',
  severityStroke: 'rgba(15,23,42,0.55)',
  boundaryCcaa: 'rgba(15,23,42,0.45)',
  boundaryProv: 'rgba(15,23,42,0.28)',
  boundaryMuni: 'rgba(15,23,42,0.16)',
  cityDot: 'rgba(15,23,42,0.85)',
  cityDotStroke: 'rgba(255,255,255,0.90)',
  label: '#0f172a',
  labelHalo: '#ffffff',
  smokeBand1: 'rgba(18,169,204,0.40)',
  smokeBand2: 'rgba(18,169,204,0.26)',
  smokeBand3: 'rgba(18,169,204,0.14)',
  smokeEdge: 'rgba(18,169,204,0.35)',
  smokeWisp: '#0c88a6',
  windChevron: '#0a6c85',
  windLabel: '#0a6c85',
  flowTrail: 'rgba(15,23,42,0.32)',
};

/**
 * Paleta del mapa para un tema. Se resuelve UNA vez, al crear el mapa: el tema
 * es constante por documento (la app siempre oscura; el widget, lo que diga su
 * URL), así que no hay repintado en caliente que mantener.
 */
export function mapPalette(theme: MapTheme): MapPalette {
  return theme === 'light' ? { ...MAP, ...MAP_LIGHT } : MAP;
}
