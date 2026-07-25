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
  // Viento: la rejilla ambiental comparte familia con los límites; las
  // flechas junto a los focos van en cian (--fm-accent-300), inconfundible
  // con la banda ámbar/roja reservada a la severidad FRP. La etiqueta km/h
  // usa un azul más marcado (--fm-accent-400): misma familia que la flecha
  // pero distinto tono, e inconfundible con el blanco de los topónimos.
  windGrid: 'rgba(226,232,240,0.5)',
  windFire: '#7fddf2',
  windLabel: '#38c7e6',
} as const;
