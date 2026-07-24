import boundary from './data/spain-boundary.json';

/**
 * Recorte al territorio español. Los bbox rectangulares de FIRMS incluyen
 * franjas de Portugal, Francia y el norte de África; este módulo descarta esos
 * focos con un point-in-polygon contra el contorno real de España.
 *
 * El contorno (server/src/data/spain-boundary.json) procede de geoBoundaries
 * ADM0 (ESP), con un buffer de ~2 km —para no perder focos costeros por la
 * resolución del píxel VIIRS (~375 m) y la simplificación— y simplificado a
 * ~1.760 vértices. Incluye Canarias, Baleares, Ceuta y Melilla.
 */

type Position = number[];
export type Ring = Position[];

interface PreparedPolygon {
  outer: Ring;
  holes: Ring[];
  bbox: [number, number, number, number];
}

const polygons: PreparedPolygon[] = (boundary.coordinates as Ring[][]).map((rings) => ({
  outer: rings[0],
  holes: rings.slice(1),
  bbox: ringBbox(rings[0]),
}));

export function isInSpain(lon: number, lat: number): boolean {
  for (const poly of polygons) {
    const [minX, minY, maxX, maxY] = poly.bbox;
    // Descarte barato por bbox antes del ray casting.
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
    if (pointInRing(lon, lat, poly.outer) && !poly.holes.some((h) => pointInRing(lon, lat, h))) {
      return true;
    }
  }
  return false;
}

/** Anillos de un polígono ([exterior, ...agujeros]) con bbox para descarte rápido. */
export interface PreparedRings {
  rings: Ring[];
  bbox: [number, number, number, number];
}

export function prepareRings(rings: Ring[]): PreparedRings {
  return { rings, bbox: ringBbox(rings[0]) };
}

export function pointInPreparedRings(x: number, y: number, prepared: PreparedRings): boolean {
  const [minX, minY, maxX, maxY] = prepared.bbox;
  if (x < minX || x > maxX || y < minY || y > maxY) return false;
  return (
    pointInRing(x, y, prepared.rings[0]) &&
    !prepared.rings.slice(1).some((hole) => pointInRing(x, y, hole))
  );
}

/** Ray casting clásico (par-impar de cruces con los lados del anillo). */
function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function ringBbox(ring: Ring): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}
