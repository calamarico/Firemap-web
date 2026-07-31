import { loadMeta } from './impact';
import { Env } from './types';

/**
 * Índice de páginas por localidad (/incendios/<slug>) derivado de
 * muni-meta.json: mapa slug→página y municipios agrupados por región para los
 * enlaces a vecinos. Lo consumen functions/incendios/[slug].ts y la landing
 * de país functions/incendios/portugal.ts.
 */

export interface MuniPage {
  name: string;
  region: string;
  regionIdx: number;
  center: [number, number];
  slug: string;
}

export interface PageIndex {
  bySlug: Map<string, MuniPage>;
  byRegion: MuniPage[][];
}

// Memo por isolate sobre loadMeta (que ya memoiza el JSON).
let pagesPromise: Promise<PageIndex | null> | null = null;

export function loadPages(env: Env): Promise<PageIndex | null> {
  pagesPromise ??= loadMeta(env).then((meta) => {
    if (!meta) {
      pagesPromise = null; // permite reintentar en la siguiente petición
      return null;
    }
    const bySlug = new Map<string, MuniPage>();
    const byRegion: MuniPage[][] = meta.regions.map(() => []);
    for (const m of meta.municipalities) {
      const page: MuniPage = {
        name: m.n,
        region: meta.regions[m.r] ?? '',
        regionIdx: m.r,
        center: m.c,
        slug: m.s,
      };
      bySlug.set(m.s, page);
      byRegion[m.r]?.push(page);
    }
    return { bySlug, byRegion };
  });
  return pagesPromise;
}
