/**
 * Genera la rejilla de puntos sobre tierra donde el cliente muestrea el viento.
 * Open-Meteo admite 1000 ubicaciones por llamada, pero su cupo diario pondera
 * ~1 llamada POR UBICACIÓN: la rejilla se mantiene deliberadamente escasa
 * (1° ≈ 65 puntos) para que una pestaña abierta el día entero no agote las
 * 10.000 diarias por IP del visitante.
 *
 *   client/src/map/windGrid.json   { spacingDeg, points: [[lon, lat], ...] }
 *
 * El JSON vive en src/ y se importa en el bundle a propósito: servirlo desde
 * /data/ pasaría por el catch-all de Pages Functions (functions/data/[[path]].ts)
 * y cada visita gastaría una invocación del plan free para un fichero de 2 KB.
 *
 * Uso:  node scripts/build-wind-grid.mjs
 * Entrada: server/data/ccaa.json (geoBoundaries)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Mismo envelope que build-muni-index.mjs: península, Baleares, Canarias,
// Ceuta y Melilla.
const X0 = -18.4;
const Y0 = 27.4;
const X1 = 4.4;
const Y1 = 43.95;
const STEP = 1.0;

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

function polygonContains(p, x, y) {
  const [minX, minY, maxX, maxY] = p.bbox;
  if (x < minX || x > maxX || y < minY || y > maxY) return false;
  return pointInRing(x, y, p.rings[0]) && !p.rings.slice(1).some((h) => pointInRing(x, y, h));
}

const regions = loadAreas('ccaa.json');
const round2 = (n) => Math.round(n * 100) / 100;

// Nodos regulares en centros de celda, solo los que caen en tierra.
const points = [];
for (let y = Y0 + STEP / 2; y < Y1; y += STEP) {
  for (let x = X0 + STEP / 2; x < X1; x += STEP) {
    if (regions.some((r) => r.polygons.some((p) => polygonContains(p, x, y)))) {
      points.push([round2(x), round2(y)]);
    }
  }
}
const gridCount = points.length;

// Representante de un polígono sin nodo regular: centro del bbox si cae en
// tierra; si no (forma cóncava), media de vértices; si tampoco, un vértice
// del contorno (siempre está en tierra).
function representative(p) {
  const [minX, minY, maxX, maxY] = p.bbox;
  let cx = (minX + maxX) / 2;
  let cy = (minY + maxY) / 2;
  if (!polygonContains(p, cx, cy)) {
    const ring = p.rings[0];
    const sum = ring.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
    cx = sum[0] / ring.length;
    cy = sum[1] / ring.length;
    if (!polygonContains(p, cx, cy)) [cx, cy] = ring[0];
  }
  return [round2(cx), round2(cy)];
}

const diagonal = (p) => Math.hypot(p.bbox[2] - p.bbox[0], p.bbox[3] - p.bbox[1]);

// Dos garantías sobre la rejilla regular:
// 1. Toda comunidad tiene al menos un punto — cubre Ceuta y Melilla, cuyo
//    bbox (~0,08°) es menor que cualquier umbral razonable de isla.
// 2. Toda isla con entidad (diagonal de bbox > 0.15°, fuera quedan islotes)
//    tiene el suyo — El Hierro, La Gomera, Formentera…
let extras = 0;
for (const region of regions) {
  const empty = (p) => !points.some(([x, y]) => polygonContains(p, x, y));
  if (region.polygons.every(empty)) {
    points.push(representative(region.polygons.reduce((a, b) => (diagonal(b) > diagonal(a) ? b : a))));
    extras++;
  }
  for (const p of region.polygons) {
    if (diagonal(p) > 0.15 && empty(p)) {
      points.push(representative(p));
      extras++;
    }
  }
}

const out = path.join(root, 'client', 'src', 'map', 'windGrid.json');
writeFileSync(out, JSON.stringify({ spacingDeg: STEP, points }) + '\n');

console.log(
  `${points.length} puntos (${gridCount} de rejilla + ${extras} de islas/exclaves) → ${path.relative(root, out)}`
);
if (points.length > 300) {
  console.warn('AVISO: más de 300 puntos; la URL de Open-Meteo empieza a ser desproporcionada.');
}
