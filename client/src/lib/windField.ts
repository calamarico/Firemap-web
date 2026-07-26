/**
 * Campo de flujo de viento: rejilla, interpolación y máscara. Matemática pura
 * (sin DOM ni MapLibre) para que el renderer y el hook compartan una sola
 * implementación y sea testeable fuera del navegador.
 *
 * El campo se muestrea a 0,5° (~55 km): enseña el flujo sinóptico — de dónde
 * viene el aire hoy —, NO el viento local de un incendio (encañonamiento de
 * valle, brisa costera). La verdad local sigue siendo la pluma de cada foco.
 */

export const D2R = Math.PI / 180;

export interface WindFieldBlockDef {
  /** Esquina suroeste de la rejilla (lon/lat del primer punto). */
  x0: number;
  y0: number;
  /** Paso de la rejilla en grados. */
  step: number;
  /** Columnas × filas; el orden de almacenamiento es fila × nx + columna. */
  nx: number;
  ny: number;
}

export interface WindFieldBlock extends WindFieldBlockDef {
  /** Componentes del vector "hacia donde sopla" (km/h), por punto. */
  u: Float32Array;
  v: Float32Array;
}

/**
 * Dos rectángulos regulares a 0,5°, con puntos de mar incluidos (sin agujeros
 * en la costa; el flujo sobre el mar es contexto legítimo). La rejilla se
 * calcula de estos seis números: un JSON de datos solo podría desincronizarse.
 */
export const WIND_FIELD_BLOCKS: readonly WindFieldBlockDef[] = [
  // Península + Baleares: 27 × 18 = 486 puntos.
  { x0: -9.5, y0: 35.75, step: 0.5, nx: 27, ny: 18 },
  // Canarias: 12 × 5 = 60 puntos.
  { x0: -18.5, y0: 27.5, step: 0.5, nx: 12, ny: 5 },
];

/** Anchura de la rampa de desvanecimiento hacia el borde de cada bloque. */
const EDGE_FADE_DEG = 0.5;

export interface BlockBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function blockBounds(def: WindFieldBlockDef): BlockBounds {
  return {
    west: def.x0,
    south: def.y0,
    east: def.x0 + (def.nx - 1) * def.step,
    north: def.y0 + (def.ny - 1) * def.step,
  };
}

/** Bloque cuyo rectángulo contiene el punto, o null (p. ej. el hueco
 *  Península–Canarias: ahí no se dibuja nada). */
export function blockContaining<T extends WindFieldBlockDef>(
  blocks: readonly T[],
  lon: number,
  lat: number
): T | null {
  for (const b of blocks) {
    const r = blockBounds(b);
    if (lon >= r.west && lon <= r.east && lat >= r.south && lat <= r.north) return b;
  }
  return null;
}

/**
 * Bilineal sobre u y v, NUNCA sobre el ángulo: interpolar 350° y 10° daría
 * 180° — viento justo del revés, el error clásico de esta clase de capas.
 */
export function sampleWindField(
  g: WindFieldBlock,
  lon: number,
  lat: number
): { dirTo: number; speed: number } {
  const fx = (lon - g.x0) / g.step;
  const fy = (lat - g.y0) / g.step;
  const i = Math.max(0, Math.min(g.nx - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(g.ny - 2, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - i));
  const ty = Math.min(1, Math.max(0, fy - j));
  const at = (a: number, b: number) => b * g.nx + a;
  const mix = (arr: Float32Array) =>
    arr[at(i, j)] * (1 - tx) * (1 - ty) +
    arr[at(i + 1, j)] * tx * (1 - ty) +
    arr[at(i, j + 1)] * (1 - tx) * ty +
    arr[at(i + 1, j + 1)] * tx * ty;
  const u = mix(g.u);
  const v = mix(g.v);
  return { dirTo: (Math.atan2(u, v) / D2R + 360) % 360, speed: Math.hypot(u, v) };
}

/**
 * Máscara de borde: 1 en el interior, rampa lineal a 0 en los últimos 0,5°
 * hacia el borde del bloque. El campo se desvanece, no se corta — y fuera del
 * rectángulo el clamp de la bilineal extrapolaría estelas paralelas sin
 * significado sobre el Atlántico (fallo real del prototipo, no portado).
 */
export function edgeFade(def: WindFieldBlockDef, lon: number, lat: number): number {
  const r = blockBounds(def);
  const d = Math.min(lon - r.west, r.east - lon, lat - r.south, r.north - lat);
  return Math.max(0, Math.min(1, d / EDGE_FADE_DEG));
}

/**
 * Rellena los puntos sin dato con la media de sus vecinos disponibles
 * (8-vecindad), en pasadas sucesivas hasta cubrir huecos contiguos.
 */
export function fillMissing(u: Float32Array, v: Float32Array, valid: boolean[], def: WindFieldBlockDef): void {
  const { nx, ny } = def;
  let pending = valid.filter((ok) => !ok).length;
  while (pending > 0) {
    let filledThisPass = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (valid[k]) continue;
        let su = 0;
        let sv = 0;
        let n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (di === 0 && dj === 0) continue;
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || ii >= nx || jj < 0 || jj >= ny) continue;
            const kk = jj * nx + ii;
            if (!valid[kk]) continue;
            su += u[kk];
            sv += v[kk];
            n++;
          }
        }
        if (n > 0) {
          u[k] = su / n;
          v[k] = sv / n;
          valid[k] = true;
          filledThisPass++;
        }
      }
    }
    if (filledThisPass === 0) break; // sin ningún dato válido en el bloque
    pending -= filledThisPass;
  }
}
