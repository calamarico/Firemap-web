/**
 * Discriminador ES/PT: los 18 distritos portugueses, EXACTAMENTE como los
 * emite scripts/merge-portugal.mjs (titleCase de CAOP) y aparecen en
 * muni-meta.regions[19..36] y en RegionImpact.name. Si se regeneran los datos
 * con otra grafía, el filtro degrada en silencio (páginas PT tratadas como ES).
 *
 * Mantener en sincronía con functions/_lib/portugal.ts.
 */
export const PT_DISTRICTS: ReadonlySet<string> = new Set([
  'Aveiro',
  'Beja',
  'Braga',
  'Bragança',
  'Castelo Branco',
  'Coimbra',
  'Évora',
  'Faro',
  'Guarda',
  'Leiria',
  'Lisboa',
  'Portalegre',
  'Porto',
  'Santarém',
  'Setúbal',
  'Viana do Castelo',
  'Vila Real',
  'Viseu',
]);

/** Slug reservado de la landing de país (/incendios/portugal). */
export const PORTUGAL_SLUG = 'portugal';

export const PORTUGAL_NAME = 'Portugal';

/** Portugal continental [minLon, minLat, maxLon, maxLat] — CAOP; Madeira y
 *  Azores no están en los datos. Encuadre de la vista país (fitBounds). */
export const PT_BBOX: [number, number, number, number] = [-9.55, 36.9, -6.15, 42.2];
