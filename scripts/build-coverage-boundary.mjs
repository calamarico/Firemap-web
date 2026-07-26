/**
 * Genera el contorno de cobertura (España + Portugal continental) que usa el
 * backend para descartar focos de países vecinos que entran en los bbox
 * rectangulares de FIRMS:
 *
 *   functions/_lib/coverage-boundary.json   MultiPolygon (geometría pelada)
 *   server/src/data/coverage-boundary.json  copia idéntica
 *
 * Procesado por país: geoBoundaries ADM0 (variante simplificada) → buffer de
 * 2 km (los focos costeros legítimos caen a veces mar adentro por la
 * resolución del sensor) → simplificación → descarte de islotes → redondeo a
 * 4 decimales. No se hace unión ESP∪PRT: el point-in-polygon del backend hace
 * OR sobre polígonos y el solape de buffers en la frontera es inocuo.
 *
 * De Portugal solo entra el continente (Madeira y Azores quedan fuera de la
 * cobertura): se filtran los polígonos con centro al oeste de -12°.
 *
 * Uso:  node scripts/build-coverage-boundary.mjs
 * Entradas: descarga ADM0 de ESP y PRT de la API de geoBoundaries (cacheado
 * en node_modules/.cache/geoboundaries/).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import buffer from '@turf/buffer';
import simplify from '@turf/simplify';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, 'node_modules', '.cache', 'geoboundaries');

const BUFFER_KM = 2;
const SIMPLIFY_TOLERANCE = 0.01;
// Islotes: fuera todo polígono con área < ~20 km² tras el buffer (un peñón
// bufferizado 2 km ronda ese tamaño). Ceuta, con ~50 km² bufferizada, entra.
const MIN_AREA_DEG2 = 0.002;
// Corte continental para PRT: Madeira está en ~-17 y las Azores en -31..-25;
// el continente no baja de -9.6.
const CONTINENTAL_LON = -12;

async function fetchAdm0(iso) {
  mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${iso.toLowerCase()}-ADM0.geojson`);
  if (!existsSync(file)) {
    const api = `https://www.geoboundaries.org/api/current/gbOpen/${iso}/ADM0/`;
    const meta = await (await fetch(api)).json();
    const res = await fetch(meta.simplifiedGeometryGeoJSON);
    if (!res.ok) throw new Error(`geoBoundaries ${iso} ADM0: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

// Área aproximada de un anillo en grados² (shoelace, sin corrección de
// latitud: basta para umbral de islotes).
function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(sum / 2);
}

function toPolygonList(geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

function processCountry(geojson, { lonMin = -Infinity } = {}) {
  const geometry = geojson.features[0].geometry;
  const kept = toPolygonList(geometry).filter((rings) => {
    const lons = rings[0].map(([x]) => x);
    const cx = (Math.min(...lons) + Math.max(...lons)) / 2;
    return cx > lonMin;
  });
  const buffered = buffer(
    { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: kept } },
    BUFFER_KM,
    { units: 'kilometers', steps: 8 }
  );
  const simplified = simplify(buffered, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false });
  const round = (n) => Math.round(n * 1e4) / 1e4;
  const polygons = [];
  for (const rings of toPolygonList(simplified.geometry)) {
    if (ringArea(rings[0]) < MIN_AREA_DEG2) continue;
    polygons.push(
      rings.map((ring) => {
        const out = [];
        for (const [x, y] of ring) {
          const p = [round(x), round(y)];
          const last = out[out.length - 1];
          if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
        }
        // Cierre del anillo tras el redondeo.
        const [first] = out;
        const last = out[out.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
        return out;
      })
    );
  }
  return polygons;
}

const [esp, prt] = await Promise.all([fetchAdm0('ESP'), fetchAdm0('PRT')]);
const polygons = [
  ...processCountry(esp),
  ...processCountry(prt, { lonMin: CONTINENTAL_LON }),
];

const out = JSON.stringify({ type: 'MultiPolygon', coordinates: polygons });
const targets = [
  path.join(root, 'functions', '_lib', 'coverage-boundary.json'),
  path.join(root, 'server', 'src', 'data', 'coverage-boundary.json'),
];
for (const t of targets) writeFileSync(t, out);
for (const old of [
  path.join(root, 'functions', '_lib', 'spain-boundary.json'),
  path.join(root, 'server', 'src', 'data', 'spain-boundary.json'),
]) {
  if (existsSync(old)) rmSync(old);
}

const vertices = polygons.reduce((a, p) => a + p.reduce((b, r) => b + r.length, 0), 0);
console.log(
  `${polygons.length} polígonos, ${vertices} vértices, ${(out.length / 1024).toFixed(1)} KB → ` +
    targets.map((t) => path.relative(root, t)).join(' + ')
);
