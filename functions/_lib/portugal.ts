/**
 * Discriminador ES/PT: los 18 distritos portugueses, EXACTAMENTE como los
 * emite scripts/merge-portugal.mjs (titleCase de CAOP) y aparecen en
 * muni-meta.regions[19..36] y en RegionImpact.name. Si se regeneran los datos
 * con otra grafía, el filtro degrada en silencio (páginas PT tratadas como ES).
 *
 * Mantener en sincronía con client/src/lib/portugal.ts.
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

/** Slug reservado de la landing de país (/incendios/portugal). Los scripts de
 *  build (build-muni-index.mjs, build-sitemap.mjs) garantizan que ningún
 *  municipio lo ocupe. */
export const PORTUGAL_SLUG = 'portugal';
