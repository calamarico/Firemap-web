/**
 * Deep links por localidad (?localidad=Nombre): resuelve el nombre de un
 * municipio a su centro usando el meta estático de municipios. El fichero
 * (~400 KB) solo se descarga si la URL trae el parámetro.
 */

export const LOCALITY_PARAM = 'localidad';

interface MuniMetaFile {
  municipalities: Array<{ n: string; c?: [number, number] }>;
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

/** Centro [lon, lat] del municipio con ese nombre, o null si no existe. */
export async function findLocalityCenter(name: string): Promise<[number, number] | null> {
  const meta = await loadMeta();
  if (!meta) return null;
  const target = normalizeName(name);
  const hit = meta.municipalities.find((m) => normalizeName(m.n) === target);
  return hit?.c ?? null;
}

/** Refleja la localidad elegida en la URL (sin ensuciar el historial). */
export function setLocalityParam(name: string | null): void {
  const url = new URL(window.location.href);
  if (name) url.searchParams.set(LOCALITY_PARAM, name);
  else url.searchParams.delete(LOCALITY_PARAM);
  window.history.replaceState(null, '', url);
}

export function getLocalityParam(): string | null {
  return new URL(window.location.href).searchParams.get(LOCALITY_PARAM);
}
