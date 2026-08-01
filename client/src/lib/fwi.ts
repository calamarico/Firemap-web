/**
 * Clases del Fire Weather Index con los colores del estilo `default` de la
 * capa ecmwf.fwi de EFFIS/GWIS — la leyenda de la capa de riesgo debe decir
 * exactamente lo que el raster pinta.
 *
 * Mantener en sincronía con FWI_CLASSES de functions/_lib/fwi.ts.
 */
export const FWI_LEGEND: ReadonlyArray<{ id: string; label: string; color: string }> = [
  { id: 'low', label: 'Bajo', color: '#9cffc0' },
  { id: 'moderate', label: 'Moderado', color: '#cde24e' },
  { id: 'high', label: 'Alto', color: '#e6ac00' },
  { id: 'very-high', label: 'Muy alto', color: '#d97010' },
  { id: 'extreme', label: 'Extremo', color: '#ad060e' },
  { id: 'very-extreme', label: 'Muy extremo', color: '#3a0015' },
];
