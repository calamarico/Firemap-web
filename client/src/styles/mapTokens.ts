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
