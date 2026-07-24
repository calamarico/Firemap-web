/**
 * Genera el índice espacial compacto municipio↔rejilla que usan las Pages
 * Functions de Cloudflare (y cualquier runtime con CPU limitada):
 *
 *   client/public/data/muni-grid.bin   Uint16 little-endian, celda → id+1 (0 = sin municipio)
 *   client/public/data/muni-meta.json  dims de la rejilla + nombres + comunidad de cada municipio
 *
 * Con celdas de 0.02° (~1,8 km) el join foco→municipio pasa de un ray-casting
 * contra 8.205 polígonos a un lookup O(1) sobre un array de bytes: apto para
 * el límite de 10 ms de CPU del free plan de Workers. El precio es que los
 * focos a <2 km de un límite municipal pueden asignarse al vecino.
 *
 * Uso:  node scripts/build-muni-index.mjs
 * Entradas: server/data/municipios.json + server/data/ccaa.json (geoBoundaries)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Rejilla: cubre península, Baleares, Canarias, Ceuta y Melilla.
const X0 = -18.4;
const Y0 = 27.4;
const X1 = 4.4;
const Y1 = 43.95;
const CELL = 0.02;
const COLS = Math.ceil((X1 - X0) / CELL);
const ROWS = Math.ceil((Y1 - Y0) / CELL);

function loadAreas(file) {
  const raw = JSON.parse(readFileSync(path.join(root, 'server', 'data', file), 'utf8'));
  return raw.features.map((f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    return {
      name: f.properties.name,
      polygons: polys.map((rings) => ({ rings, bbox: ringBbox(rings[0]) })),
    };
  });
}

function ringBbox(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function areaContains(area, x, y) {
  for (const p of area.polygons) {
    const [minX, minY, maxX, maxY] = p.bbox;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    if (pointInRing(x, y, p.rings[0]) && !p.rings.slice(1).some((h) => pointInRing(x, y, h))) {
      return true;
    }
  }
  return false;
}

console.time('total');
const municipalities = loadAreas('municipios.json');
const regions = loadAreas('ccaa.json');

// Comunidad de cada municipio, por el punto medio de su bbox (con fallback a
// probar un vértice si el punto medio cae fuera de todo, p. ej. formas cóncavas).
const regionNames = regions.map((r) => r.name);
// Centroide aproximado de cada comunidad (media de vértices del anillo mayor),
// para el fallback de municipios costeros cuyo bbox-centro cae al mar.
const regionCentroids = regions.map((r) => {
  const ring = r.polygons.reduce((a, b) => (b.rings[0].length > a.rings[0].length ? b : a)).rings[0];
  const sum = ring.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [sum[0] / ring.length, sum[1] / ring.length];
});
const muniRegion = municipalities.map((m) => {
  const [minX, minY, maxX, maxY] = m.polygons[0].bbox;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let idx = regions.findIndex((r) => areaContains(r, cx, cy));
  if (idx === -1) {
    const [vx, vy] = m.polygons[0].rings[0][0];
    idx = regions.findIndex((r) => areaContains(r, vx, vy));
  }
  if (idx === -1) {
    // Costa/islas: gana la comunidad con centroide más cercano.
    let best = Infinity;
    regionCentroids.forEach(([rx, ry], i) => {
      const d = (rx - cx) ** 2 + (ry - cy) ** 2;
      if (d < best) {
        best = d;
        idx = i;
      }
    });
  }
  return idx;
});

// Cubos gruesos de 0.2° para no probar los 8.205 municipios en cada celda.
const BUCKET = 0.2;
const bCols = Math.ceil((X1 - X0) / BUCKET);
const bRows = Math.ceil((Y1 - Y0) / BUCKET);
const buckets = Array.from({ length: bCols * bRows }, () => []);
municipalities.forEach((m, id) => {
  for (const p of m.polygons) {
    const [minX, minY, maxX, maxY] = p.bbox;
    const c0 = Math.max(0, Math.floor((minX - X0) / BUCKET));
    const c1 = Math.min(bCols - 1, Math.floor((maxX - X0) / BUCKET));
    const r0 = Math.max(0, Math.floor((minY - Y0) / BUCKET));
    const r1 = Math.min(bRows - 1, Math.floor((maxY - Y0) / BUCKET));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const bucket = buckets[r * bCols + c];
        if (bucket[bucket.length - 1] !== id) bucket.push(id);
      }
    }
  }
});

const grid = new Uint16Array(COLS * ROWS);
let assigned = 0;
for (let row = 0; row < ROWS; row++) {
  const y = Y0 + (row + 0.5) * CELL;
  const bRow = Math.min(bRows - 1, Math.floor((y - Y0) / BUCKET));
  for (let col = 0; col < COLS; col++) {
    const x = X0 + (col + 0.5) * CELL;
    const bCol = Math.min(bCols - 1, Math.floor((x - X0) / BUCKET));
    for (const id of buckets[bRow * bCols + bCol]) {
      if (areaContains(municipalities[id], x, y)) {
        grid[row * COLS + col] = id + 1; // 0 queda reservado para "ninguno"
        assigned++;
        break;
      }
    }
  }
}
console.timeEnd('total');

const outDir = path.join(root, 'client', 'public', 'data');
// Uint16Array serializa en el endianness de la máquina; x64/arm64 y workerd
// son little-endian, que es lo que asume el lector.
writeFileSync(path.join(outDir, 'muni-grid.bin'), Buffer.from(grid.buffer));
writeFileSync(
  path.join(outDir, 'muni-meta.json'),
  JSON.stringify({
    grid: { x0: X0, y0: Y0, cell: CELL, cols: COLS, rows: ROWS },
    regions: regionNames,
    municipalities: municipalities.map((m, i) => ({ n: m.name, r: muniRegion[i] })),
  })
);

console.log(
  `rejilla ${COLS}×${ROWS} (${((COLS * ROWS * 2) / 1e6).toFixed(1)} MB bin), ` +
    `${assigned} celdas asignadas (${((assigned / (COLS * ROWS)) * 100).toFixed(1)}%), ` +
    `${municipalities.length} municipios, ${regionNames.length} comunidades`
);
const unassigned = muniRegion.filter((r) => r === -1).length;
if (unassigned > 0) console.warn(`AVISO: ${unassigned} municipios sin comunidad asignada`);
