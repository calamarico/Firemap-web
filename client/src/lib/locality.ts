/**
 * Deep links por localidad: la forma canónica es el path /incendios/<slug>
 * (páginas SEO servidas con metadatos propios por functions/incendios/[slug].ts
 * en el despliegue Cloudflare); ?localidad=Nombre se mantiene como formato
 * legacy y migra al path al resolverse. Los slugs son el campo `s` del meta
 * estático de municipios (~575 KB, solo se descarga si la URL trae localidad).
 */

import { PT_DISTRICTS } from './portugal';

export const LOCALITY_PARAM = 'localidad';
const PATH_RE = /^\/incendios\/([^/]+)\/?$/;

/** Debe coincidir con el <title> de index.html. */
const DEFAULT_TITLE = 'Mapa de incendios en España y Portugal hoy, en tiempo real';

interface MuniMetaFile {
  regions?: string[];
  municipalities: Array<{ n: string; r?: number; s?: string; c?: [number, number] }>;
}

export interface LocalityHit {
  name: string;
  slug: string;
  center: [number, number];
}

/** Localidad activa en la app: municipio elegido o vista de país (Portugal). */
export interface ActiveLocality {
  name: string;
  slug: string;
  kind: 'municipality' | 'country';
}

let metaPromise: Promise<MuniMetaFile | null> | null = null;

function loadMeta(): Promise<MuniMetaFile | null> {
  metaPromise ??= fetch('/data/muni-meta.json')
    .then((res) => (res.ok ? (res.json() as Promise<MuniMetaFile>) : null))
    .catch(() => null);
  return metaPromise;
}

/** Comparación tolerante: sin tildes, sin mayúsculas, sin espacios sobrantes. */
function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function toHit(m: { n: string; s?: string; c?: [number, number] }): LocalityHit | null {
  return m.s && m.c ? { name: m.n, slug: m.s, center: m.c } : null;
}

/** Localidad por slug exacto (/incendios/<slug>), o null si no existe. */
export async function findLocalityBySlug(slug: string): Promise<LocalityHit | null> {
  const meta = await loadMeta();
  if (!meta) return null;
  const hit = meta.municipalities.find((m) => m.s === slug);
  return hit ? toHit(hit) : null;
}

/** Localidad por nombre (legacy ?localidad=), primer match tolerante, o null. */
export async function findLocalityByName(name: string): Promise<LocalityHit | null> {
  const meta = await loadMeta();
  if (!meta) return null;
  const target = normalizeName(name);
  const hit = meta.municipalities.find((m) => normalizeName(m.n) === target);
  return hit ? toHit(hit) : null;
}

export interface NearbyLocalities {
  region: string;
  isPortugal: boolean;
  neighbors: LocalityHit[];
}

/**
 * Municipios más cercanos de la misma región, por distancia euclídea sobre los
 * centroides. Réplica client-side del bloque de vecinos que el server inyecta
 * en /incendios/<slug> (functions/incendios/[slug].ts, renderNeighbors): React
 * lo destruye al montar, y esta versión lo repone en la interfaz.
 */
export async function findNearby(slug: string, limit = 10): Promise<NearbyLocalities | null> {
  const meta = await loadMeta();
  if (!meta?.regions) return null;
  const self = meta.municipalities.find((m) => m.s === slug);
  if (!self || self.r === undefined || !self.c) return null;
  const region = meta.regions[self.r] ?? '';
  const [x, y] = self.c;
  const neighbors = meta.municipalities
    .filter((m) => m.r === self.r && m.s !== slug)
    .flatMap((m) => {
      const hit = toHit(m);
      return hit ? [{ hit, d: (hit.center[0] - x) ** 2 + (hit.center[1] - y) ** 2 }] : [];
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((entry) => entry.hit);
  return { region, isPortugal: PT_DISTRICTS.has(region), neighbors };
}

/** Los 18 concelhos capital de distrito (nombre == nombre del distrito), para
 *  el bloque de enlaces de la vista país. Misma regla que el server
 *  (functions/incendios/portugal.ts, districtCapitals). */
export async function portugalCapitals(): Promise<LocalityHit[]> {
  const meta = await loadMeta();
  if (!meta?.regions) return [];
  const capitals: LocalityHit[] = [];
  meta.regions.forEach((region, r) => {
    if (!PT_DISTRICTS.has(region)) return;
    const capital = meta.municipalities.find((m) => m.r === r && m.n === region);
    const hit = capital ? toHit(capital) : null;
    if (hit) capitals.push(hit);
  });
  return capitals.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * Refleja la localidad elegida en la URL (sin ensuciar el historial) y en el
 * título del documento — así lo que se comparte lleva un título descriptivo y
 * apunta a la página indexable /incendios/<slug>. Con null restaura la raíz.
 */
export function setLocalityParam(name: string | null, slug?: string): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(LOCALITY_PARAM); // el formato legacy nunca se re-emite
  url.pathname = name && slug ? `/incendios/${slug}` : '/';
  window.history.replaceState(null, '', url);
  document.title = name ? `Incendios en ${name} · Radar de Incendios` : DEFAULT_TITLE;
}

/** Slug de la URL actual (/incendios/<slug>), o null. */
export function getLocalitySlug(): string | null {
  const match = PATH_RE.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]).toLowerCase() : null;
}

/** Nombre del parámetro legacy ?localidad=, o null. */
export function getLocalityParam(): string | null {
  return new URL(window.location.href).searchParams.get(LOCALITY_PARAM);
}
