import boundary from './spain-boundary.json';

/**
 * Recorte al territorio español (mismo contorno y misma lógica que
 * server/src/geo.ts): descarta los focos de países vecinos que entran en los
 * bbox rectangulares de FIRMS. El JSON pesa 31 KB: cabe de sobra en el límite
 * de bundle del free plan de Workers.
 */

type Position = number[];
type Ring = Position[];

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
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
    if (pointInRing(lon, lat, poly.outer) && !poly.holes.some((h) => pointInRing(lon, lat, h))) {
      return true;
    }
  }
  return false;
}

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
