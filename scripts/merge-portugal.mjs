/**
 * Fusiona Portugal continental en los datasets administrativos del repo:
 *
 *   server/data/municipios.json           + 278 concelhos (CAOP)
 *   server/data/ccaa.json                 + 18 distritos (CAOP)
 *   client/public/data/ccaa.json          copia idéntica de la anterior
 *   client/public/data/ccaa-labels.json   + 18 etiquetas de distrito
 *   node_modules/.cache/geoboundaries/municipios-labels.geojson
 *                                         un Point por municipio/concelho, la
 *                                         entrada de municipios-labels.pmtiles
 *                                         (comando de tippecanoe en README.md)
 *
 * Fuente: CAOP (Carta Administrativa Oficial de Portugal) vía el espejo
 * GeoJSON nmota/caop_GeoJSON. El ADM2 de geoBoundaries se descartó: trae los
 * concelhos a ~14-24 vértices (el de Lisboa recorta media ciudad) y con
 * erratas en los nombres ("Setubul", "Alijezur"). La CAOP llega a resolución
 * completa (~36 MB el continente), así que aquí se simplifica y se redondea a
 * 4 decimales para quedar en una densidad comparable a la de los municipios
 * españoles (geoBoundaries ADM3). Los nombres CAOP vienen en MAYÚSCULAS con
 * tildes correctas; se pasan a formato título con los conectores en minúscula
 * ("VILA REAL DE SANTO ANTÓNIO" → "Vila Real de Santo António").
 *
 * Madeira y Azores quedan fuera (los ficheros de continente no las incluyen).
 *
 * El script es de un solo uso sobre los datos originales: si detecta que los
 * distritos portugueses ya están fusionados, aborta (restaura los ficheros
 * desde git antes de re-ejecutar).
 *
 * Uso:  node scripts/merge-portugal.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import simplify from '@turf/simplify';
import proj4 from 'proj4';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, 'node_modules', '.cache', 'geoboundaries');

const CAOP_BASE = 'https://raw.githubusercontent.com/nmota/caop_GeoJSON/master';
// Tolerancias de simplificación (grados; 0.001 ≈ 110 m). Los concelhos se ven
// hasta z12 (~35 m/px), pero tippecanoe re-simplifica por zoom: aquí solo hay
// que contener el peso de municipios.json (lo carga el server Node en memoria).
const CONCELHO_TOLERANCE = 0.0005;
// Los distritos van en ccaa.json, que descarga el navegador: más agresivo.
const DISTRITO_TOLERANCE = 0.002;

async function fetchCaop(file) {
  mkdirSync(cacheDir, { recursive: true });
  const local = path.join(cacheDir, file);
  if (!existsSync(local)) {
    const res = await fetch(`${CAOP_BASE}/${file === 'caop-concelhos.geojson' ? 'ContinenteConcelhos.geojson' : 'ContinenteDistritos.geojson'}`);
    if (!res.ok) throw new Error(`CAOP ${file}: HTTP ${res.status}`);
    writeFileSync(local, Buffer.from(await res.arrayBuffer()));
  }
  let raw = readFileSync(local, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // BOM
  return JSON.parse(raw);
}

// Conectores que van en minúscula en los topónimos portugueses.
const CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'à', 'em']);

function titleCase(upper) {
  return upper
    .toLowerCase()
    .split(' ')
    .map((word, i) =>
      word
        .split('-')
        .map((part, j) =>
          (i > 0 || j > 0) && CONNECTORS.has(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)
        )
        .join('-')
    )
    .join(' ');
}

const toPolygonList = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
const round = (n) => Math.round(n * 1e4) / 1e4;

// La CAOP viene en la proyección oficial ETRS89 / Portugal TM06 (EPSG:3763,
// metros); el resto del pipeline trabaja en WGS84.
const PT_TM06 =
  '+proj=tmerc +lat_0=39.66825833333333 +lon_0=-8.133108333333334 +k=1 +x_0=0 +y_0=0 ' +
  '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const toWgs84 = proj4(PT_TM06, proj4.WGS84);

function reprojectGeometry(geometry) {
  const polygons = toPolygonList(geometry).map((rings) =>
    rings.map((ring) => ring.map(([x, y]) => toWgs84.forward([x, y])))
  );
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

function roundGeometry(geometry) {
  const polygons = toPolygonList(geometry).map((rings) =>
    rings.map((ring) => {
      const out = [];
      for (const [x, y] of ring) {
        const p = [round(x), round(y)];
        const last = out[out.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
      }
      const [first] = out;
      const last = out[out.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
      return out;
    })
  );
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

function simplifyFeature(feature, tolerance) {
  const wgs84 = { type: 'Feature', properties: {}, geometry: reprojectGeometry(feature.geometry) };
  return simplify(wgs84, { tolerance, highQuality: true }).geometry;
}

function largestPolygonBboxCenter(geometry) {
  let best = null;
  let bestDiag = -1;
  for (const rings of toPolygonList(geometry)) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of rings[0]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const diag = Math.hypot(maxX - minX, maxY - minY);
    if (diag > bestDiag) {
      bestDiag = diag;
      best = [round((minX + maxX) / 2), round((minY + maxY) / 2)];
    }
  }
  return best;
}

// --- Cargas ---
const muniPath = path.join(root, 'server', 'data', 'municipios.json');
const ccaaServerPath = path.join(root, 'server', 'data', 'ccaa.json');
const ccaaClientPath = path.join(root, 'client', 'public', 'data', 'ccaa.json');
const labelsPath = path.join(root, 'client', 'public', 'data', 'ccaa-labels.json');

const municipios = JSON.parse(readFileSync(muniPath, 'utf8'));
const ccaa = JSON.parse(readFileSync(ccaaServerPath, 'utf8'));
const ccaaLabels = JSON.parse(readFileSync(labelsPath, 'utf8'));

if (ccaa.features.some((f) => f.properties.name === 'Lisboa')) {
  console.error('Los datasets ya contienen Portugal; restaura los originales desde git antes de re-ejecutar.');
  process.exit(1);
}

const [caopConcelhos, caopDistritos] = await Promise.all([
  fetchCaop('caop-concelhos.geojson'),
  fetchCaop('caop-distritos.geojson'),
]);

const districts = caopDistritos.features.map((f) => ({
  type: 'Feature',
  properties: { name: titleCase(f.properties.Distrito) },
  geometry: roundGeometry(simplifyFeature(f, DISTRITO_TOLERANCE)),
}));
if (districts.length !== 18) throw new Error(`Se esperaban 18 distritos, hay ${districts.length}`);

const concelhos = caopConcelhos.features.map((f) => ({
  type: 'Feature',
  properties: { name: titleCase(f.properties.Concelho) },
  geometry: roundGeometry(simplifyFeature(f, CONCELHO_TOLERANCE)),
}));
if (concelhos.length !== 278) throw new Error(`Se esperaban 278 concelhos, hay ${concelhos.length}`);

// Colisiones de nombre ES↔PT: los deep links (?localidad=) resuelven por
// primer match, así que el municipio español gana. Se listan para constancia.
const spanishNames = new Set(municipios.features.map((f) => f.properties.name));
const collisions = concelhos.filter((f) => spanishNames.has(f.properties.name)).map((f) => f.properties.name);
if (collisions.length > 0) {
  console.warn(`AVISO: nombres duplicados ES↔PT (gana el municipio español en ?localidad=): ${collisions.join(', ')}`);
}

// --- Escrituras (ESP primero: en zonas dudosas como Olivenza gana España) ---
municipios.features.push(...concelhos);
writeFileSync(muniPath, JSON.stringify(municipios));

ccaa.features.push(...districts);
const ccaaOut = JSON.stringify(ccaa);
writeFileSync(ccaaServerPath, ccaaOut);
writeFileSync(ccaaClientPath, ccaaOut);

ccaaLabels.features.push(
  ...districts.map((d) => ({
    type: 'Feature',
    properties: { name: d.properties.name },
    geometry: { type: 'Point', coordinates: largestPolygonBboxCenter(d.geometry) },
  }))
);
writeFileSync(labelsPath, JSON.stringify(ccaaLabels));

// Entrada del pmtiles de etiquetas: un Point por municipio/concelho.
const labelsOut = path.join(cacheDir, 'municipios-labels.geojson');
writeFileSync(
  labelsOut,
  JSON.stringify({
    type: 'FeatureCollection',
    features: municipios.features.map((f) => ({
      type: 'Feature',
      properties: { name: f.properties.name },
      geometry: { type: 'Point', coordinates: largestPolygonBboxCenter(f.geometry) },
    })),
  })
);

const bytes = (f) => JSON.stringify(f).length;
console.log(
  `${concelhos.length} concelhos (${(concelhos.reduce((a, f) => a + bytes(f), 0) / 1e6).toFixed(1)} MB) + ` +
    `${districts.length} distritos (${(districts.reduce((a, f) => a + bytes(f), 0) / 1e3).toFixed(0)} KB) → ` +
    `${municipios.features.length} municipios, ${ccaa.features.length} regiones. ` +
    `Etiquetas: ${path.relative(root, labelsOut)}`
);
