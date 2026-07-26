/**
 * Deep links por localidad: la forma canónica es el path /incendios/<slug>
 * (páginas SEO servidas con metadatos propios por functions/incendios/[slug].ts
 * en el despliegue Cloudflare); ?localidad=Nombre se mantiene como formato
 * legacy y migra al path al resolverse. Los slugs son el campo `s` del meta
 * estático de municipios (~575 KB, solo se descarga si la URL trae localidad).
 */

export const LOCALITY_PARAM = 'localidad';
const PATH_RE = /^\/incendios\/([^/]+)\/?$/;

/** Debe coincidir con el <title> de index.html. */
const DEFAULT_TITLE = 'Mapa de incendios en España y Portugal hoy, en tiempo real · Firemaps';

interface MuniMetaFile {
  municipalities: Array<{ n: string; s?: string; c?: [number, number] }>;
}

export interface LocalityHit {
  name: string;
  slug: string;
  center: [number, number];
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
  document.title = name ? `Incendios en ${name} · Firemaps España` : DEFAULT_TITLE;
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
