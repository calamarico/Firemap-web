import type { FeatureCollection, Point } from 'geojson';
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  StyleSpecification,
} from 'maplibre-gl';
import { MAP, SEVERITY } from '../styles/mapTokens';
import type { EffisRange, FireHotspot, WindPoint, WindPointKind } from '../types';
import { EFFIS_TILE_PROTOCOL } from './effisTileCache';

/**
 * Abstracción mínima de capa de la aplicación: cada fuente de datos (FIRMS,
 * EFFIS, futuras capas del 112, otros sensores...) implementa esta interfaz y
 * MapView solo orquesta add/visibilidad. Añadir una fuente nueva = escribir
 * una función create*Layer y registrarla en MapView, sin tocar nada más.
 */
export interface AppLayer {
  readonly id: string;
  add(map: MapLibreMap): void;
  setVisible(map: MapLibreMap, visible: boolean): void;
}

export const FIRES_SOURCE_ID = 'firms-hotspots';
export const FIRES_LAYER_ID = 'firms-hotspots-circles';
const EFFIS_SOURCE_ID = 'effis-burnt-areas';
const EFFIS_LAYER_ID = 'effis-burnt-areas-raster';
const BOUNDARIES_SOURCE_ID = 'ccaa-boundaries';
export const BOUNDARIES_LAYER_ID = 'ccaa-boundaries-lines';
const CCAA_LABELS_SOURCE_ID = 'ccaa-labels';
const CCAA_LABELS_LAYER_ID = 'ccaa-labels-text';
const PROVINCES_SOURCE_ID = 'provincias';
const PROVINCES_LAYER_ID = 'provincias-lines';
const MUNICIPALITIES_SOURCE_ID = 'municipios';
const MUNICIPALITIES_LABELS_SOURCE_ID = 'municipios-labels';
export const MUNICIPALITIES_LAYER_ID = 'municipios-lines';
const MUNICIPALITIES_LABELS_LAYER_ID = 'municipios-text';
const CITIES_SOURCE_ID = 'cities';
const CITIES_DOTS_LAYER_ID = 'cities-dots';
const CITIES_LABELS_LAYER_ID = 'cities-text';
const WIND_SOURCE_ID = 'wind';
const WIND_SWEEP_SOURCE_ID = 'wind-sweep';
const WIND_GRID_LAYER_ID = 'wind-grid-arrows';
const WIND_FIRES_LAYER_ID = 'wind-fire-arrows';
const WIND_SWEEP_LAYER_ID = 'wind-fire-sweep';

export type BasemapId = 'satellite' | 'dark';

/**
 * Estilo base con dos fondos raster sin API key, al estilo del visor de FIRMS:
 * - satellite: Esri World Imagery (imagen satelital, nítida a todos los zooms)
 * - dark: CARTO Dark Matter en su variante SIN etiquetas. Las etiquetas van
 *   horneadas en el raster y CARTO las sirve con topónimos anglificados
 *   ("CATALONIA", "SEVILLE"); usamos dark_nolabels y pintamos nuestras propias
 *   etiquetas en castellano como capas de símbolos (CCAA y ciudades).
 * Ambos viven en el estilo y setBasemap() alterna su visibilidad, así el
 * cambio de fondo no recrea el mapa ni toca las capas de datos.
 */
export const BASE_STYLE: StyleSpecification = {
  version: 8,
  // Servidor de glifos de CARTO (gratuito, lo usan sus propios estilos GL):
  // necesario para que MapLibre pueda renderizar texto.
  glyphs: 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf',
  sources: {
    satellite: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        'Imágenes © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
    },
    'carto-dark': {
      type: 'raster',
      tiles: ['a', 'b', 'c', 'd'].map(
        (s) => `https://${s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png`
      ),
      tileSize: 256,
      maxzoom: 20,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    // Fondo bajo las teselas: azul océano profundo. Es lo que asoma mientras
    // una tesela no ha llegado (o si el proveedor falla); sin esto asomaría
    // el blanco por defecto de MapLibre, que es un fogonazo sobre UI oscura.
    { id: 'background', type: 'background', paint: { 'background-color': MAP.void } },
    { id: 'basemap-satellite', type: 'raster', source: 'satellite' },
    { id: 'basemap-dark', type: 'raster', source: 'carto-dark', layout: { visibility: 'none' } },
  ],
};

export function setBasemap(map: MapLibreMap, basemap: BasemapId): void {
  map.setLayoutProperty('basemap-satellite', 'visibility', basemap === 'satellite' ? 'visible' : 'none');
  map.setLayoutProperty('basemap-dark', 'visibility', basemap === 'dark' ? 'visible' : 'none');
}

const EMPTY_COLLECTION: FeatureCollection<Point, FireHotspot> = {
  type: 'FeatureCollection',
  features: [],
};

export function hotspotsToGeoJSON(hotspots: FireHotspot[]): FeatureCollection<Point, FireHotspot> {
  return {
    type: 'FeatureCollection',
    features: hotspots.map((h) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [h.longitude, h.latitude] },
      properties: h,
    })),
  };
}

export interface FiresLayer extends AppLayer {
  setData(map: MapLibreMap, hotspots: FireHotspot[]): void;
}

export function createFiresLayer(): FiresLayer {
  // La misma escala de severidad alimenta la leyenda: un solo sitio que mantener.
  const [low, mid, high, extreme] = SEVERITY;
  return {
    id: FIRES_LAYER_ID,
    add(map) {
      map.addSource(FIRES_SOURCE_ID, { type: 'geojson', data: EMPTY_COLLECTION });
      map.addLayer({
        id: FIRES_LAYER_ID,
        type: 'circle',
        source: FIRES_SOURCE_ID,
        paint: {
          'circle-color': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'frp'], 0],
            0,
            low.color,
            low.upTo,
            mid.color,
            mid.upTo,
            high.color,
            high.upTo,
            extreme.color,
          ],
          'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'frp'], 0], 0, 5, 50, 11],
          'circle-opacity': 0.9,
          // El alfa del trazo (0.85) va dentro del propio color del token.
          'circle-stroke-color': MAP.severityStroke,
          'circle-stroke-width': 1,
        },
      });
    },
    setVisible(map, visible) {
      map.setLayoutProperty(FIRES_LAYER_ID, 'visibility', visible ? 'visible' : 'none');
    },
    setData(map, hotspots) {
      const source = map.getSource(FIRES_SOURCE_ID) as GeoJSONSource | undefined;
      source?.setData(hotspotsToGeoJSON(hotspots));
    },
  };
}

/**
 * Límites administrativos escalonados por zoom (todos de geoBoundaries):
 * comunidades autónomas siempre, provincias a partir de zoom 6.5 y municipios
 * a partir de zoom 7, con nombres desde zoom 8.5. Los municipios (8.205
 * polígonos) van en teselas vectoriales PMTiles: el navegador pide por HTTP
 * Range solo las teselas del viewport, con el detalle ajustado a cada zoom —
 * ni descarga completa ni simplificación fija. Los nombres de las CCAA van en
 * castellano (ccaa-labels.json, centroides precalculados).
 */
export function createBoundariesLayer(): AppLayer {
  return {
    id: BOUNDARIES_LAYER_ID,
    add(map) {
      map.addSource(BOUNDARIES_SOURCE_ID, {
        type: 'geojson',
        data: `${window.location.origin}/data/ccaa.json`,
        attribution: 'Límites: <a href="https://www.geoboundaries.org/">geoBoundaries</a>',
      });
      map.addSource(PROVINCES_SOURCE_ID, {
        type: 'geojson',
        data: `${window.location.origin}/data/provincias.json`,
      });
      map.addSource(MUNICIPALITIES_SOURCE_ID, {
        type: 'vector',
        url: `pmtiles://${window.location.origin}/data/municipios.pmtiles`,
      });
      map.addSource(MUNICIPALITIES_LABELS_SOURCE_ID, {
        type: 'vector',
        url: `pmtiles://${window.location.origin}/data/municipios-labels.pmtiles`,
      });
      map.addSource(CCAA_LABELS_SOURCE_ID, {
        type: 'geojson',
        data: `${window.location.origin}/data/ccaa-labels.json`,
      });

      // Orden interno: municipios (más fino) debajo, CCAA (más grueso) encima.
      map.addLayer({
        id: MUNICIPALITIES_LAYER_ID,
        type: 'line',
        source: MUNICIPALITIES_SOURCE_ID,
        'source-layer': 'municipios',
        minzoom: 7,
        paint: {
          'line-color': MAP.boundaryMuni,
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.4, 13, 1.1],
        },
      });
      map.addLayer({
        id: PROVINCES_LAYER_ID,
        type: 'line',
        source: PROVINCES_SOURCE_ID,
        minzoom: 6.5,
        paint: {
          'line-color': MAP.boundaryProv,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6.5, 0.6, 11, 1.2],
        },
      });
      map.addLayer({
        id: BOUNDARIES_LAYER_ID,
        type: 'line',
        source: BOUNDARIES_SOURCE_ID,
        paint: {
          'line-color': MAP.boundaryCcaa,
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 10, 1.6],
        },
      });
      map.addLayer({
        id: MUNICIPALITIES_LABELS_LAYER_ID,
        type: 'symbol',
        source: MUNICIPALITIES_LABELS_SOURCE_ID,
        'source-layer': 'labels',
        minzoom: 8.5,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Montserrat Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8.5, 11, 13, 14],
        },
        paint: {
          'text-color': MAP.label,
          'text-halo-color': MAP.labelHalo,
          'text-halo-width': 2,
        },
      });
      map.addLayer({
        id: CCAA_LABELS_LAYER_ID,
        type: 'symbol',
        source: CCAA_LABELS_SOURCE_ID,
        maxzoom: 9,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Montserrat Medium'],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.12,
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10.5, 8, 15],
        },
        paint: {
          'text-color': MAP.label,
          // Halo oscuro: legible tanto sobre satélite como sobre fondo oscuro.
          'text-halo-color': MAP.labelHalo,
          'text-halo-width': 1.8,
        },
      });
    },
    setVisible(map, v) {
      const value = v ? 'visible' : 'none';
      for (const id of [
        MUNICIPALITIES_LAYER_ID,
        PROVINCES_LAYER_ID,
        BOUNDARIES_LAYER_ID,
        MUNICIPALITIES_LABELS_LAYER_ID,
        CCAA_LABELS_LAYER_ID,
      ]) {
        map.setLayoutProperty(id, 'visibility', value);
      }
    },
  };
}

/**
 * Capitales y ciudades grandes (estático en /data/cities.json, en castellano).
 * Sustituyen a las etiquetas horneadas que perdimos al pasar a dark_nolabels
 * y dan referencia urbana también sobre el satélite. Aparecen a partir de
 * zoom 6 para no competir con los nombres de las comunidades.
 */
export function createCitiesLayer(): AppLayer {
  return {
    id: CITIES_LABELS_LAYER_ID,
    add(map) {
      map.addSource(CITIES_SOURCE_ID, {
        type: 'geojson',
        data: `${window.location.origin}/data/cities.json`,
      });
      map.addLayer({
        id: CITIES_DOTS_LAYER_ID,
        type: 'circle',
        source: CITIES_SOURCE_ID,
        minzoom: 6,
        paint: {
          'circle-color': MAP.cityDot,
          'circle-radius': 2.5,
          'circle-stroke-color': MAP.cityDotStroke,
          'circle-stroke-width': 1,
        },
      });
      map.addLayer({
        id: CITIES_LABELS_LAYER_ID,
        type: 'symbol',
        source: CITIES_SOURCE_ID,
        minzoom: 6,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Montserrat Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 10, 14.5],
          'text-offset': [0, 0.9],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': MAP.label,
          'text-halo-color': MAP.labelHalo,
          'text-halo-width': 2,
        },
      });
    },
    setVisible(map, visible) {
      const value = visible ? 'visible' : 'none';
      map.setLayoutProperty(CITIES_DOTS_LAYER_ID, 'visibility', value);
      map.setLayoutProperty(CITIES_LABELS_LAYER_ID, 'visibility', value);
    },
  };
}

export interface EffisLayer extends AppLayer {
  setRange(map: MapLibreMap, range: EffisRange): void;
  /**
   * Recarga los tiles descartando lo ya pintado. Pensado para cuando EFFIS
   * vuelve tras una caída: MapLibre nunca reintenta tiles por su cuenta, así
   * que sin esto los huecos (o basura cacheada) durarían hasta el siguiente
   * paneo a zona virgen.
   */
  refresh(map: MapLibreMap): void;
}

/**
 * Perímetros EFFIS como capa raster WMS: MapLibre sustituye {bbox-epsg-3857}
 * por el bbox de cada tile y el proxy reenvía el GetMap al endpoint vivo.
 * La capa "late" (opacidad en onda senoidal) para llamar la atención sobre el
 * área quemada; al ser un raster, el latido es del conjunto de la capa.
 */
export function createEffisLayer(initialRange: EffisRange): EffisLayer {
  let range = initialRange;
  let visible = true;
  let pulseFrame: number | null = null;
  // Sube con cada refresh(): cambia la URL de tiles para saltarse el max-age
  // del navegador (si no, tras una caída reaparecerían los tiles malos).
  let epoch = 0;

  const PULSE_MIN = 0.4;
  const PULSE_MAX = 0.85;
  const PULSE_PERIOD_MS = 2400;

  const stopPulse = () => {
    if (pulseFrame !== null) {
      cancelAnimationFrame(pulseFrame);
      pulseFrame = null;
    }
  };

  const startPulse = (map: MapLibreMap) => {
    stopPulse();
    // La capa queda estática con "reducir movimiento" (accesibilidad) y en
    // pantallas táctiles: cada cambio de opacidad repinta el canvas entero,
    // y ese repintado continuo es lo que hacía ir a tirones el mapa en móvil.
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      window.matchMedia('(pointer: coarse)').matches
    ) {
      if (map.getLayer(EFFIS_LAYER_ID)) map.setPaintProperty(EFFIS_LAYER_ID, 'raster-opacity', 0.75);
      return;
    }
    let lastApplied = 0;
    const tick = (now: number) => {
      if (!map.getLayer(EFFIS_LAYER_ID)) {
        pulseFrame = null;
        return;
      }
      // ~11 pasos/s bastan para una onda de 2,4 s (el salto de opacidad por
      // paso es imperceptible) y evitan repintar a 60 fps con el mapa quieto.
      // Durante un gesto tampoco se toca: el repintado ya lo paga el propio
      // movimiento y esto solo añadiría invalidaciones de estilo.
      if (now - lastApplied >= 90 && !map.isMoving()) {
        lastApplied = now;
        const phase = 0.5 + 0.5 * Math.sin((now / PULSE_PERIOD_MS) * 2 * Math.PI);
        map.setPaintProperty(
          EFFIS_LAYER_ID,
          'raster-opacity',
          PULSE_MIN + (PULSE_MAX - PULSE_MIN) * phase
        );
      }
      pulseFrame = requestAnimationFrame(tick);
    };
    pulseFrame = requestAnimationFrame(tick);
  };

  const addSourceAndLayer = (map: MapLibreMap, beforeId?: string) => {
    map.addSource(EFFIS_SOURCE_ID, {
      type: 'raster',
      tiles: [tilesUrl()],
      // Teselas de 512: cada GetMap cubre 4 veces más pantalla que una de 256,
      // así que cada gesto dispara ~4 veces menos invocaciones del Worker (y
      // la resolución sobra para un relleno translúcido de perímetros).
      tileSize: 512,
      // EFFIS cubre Europa, pero fuera de España+margen no interesa: sin
      // bounds, panear hacia Francia seguiría gastando GetMaps (= quota).
      bounds: [-19.5, 26.5, 5.5, 45],
      // Más allá de z12 se estira la tesela de z12 (~10 m/px): de sobra para
      // perímetros, y al acercar el zoom no se pide ni un GetMap más.
      maxzoom: 12,
      attribution: '© <a href="https://forest-fire.emergency.copernicus.eu/">EFFIS / Copernicus</a>',
    });
    map.addLayer(
      {
        id: EFFIS_LAYER_ID,
        type: 'raster',
        source: EFFIS_SOURCE_ID,
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: { 'raster-opacity': 0.75 },
      },
      beforeId
    );
    // Sin transición interna: el rAF del latido ya interpola; la transición
    // por defecto (300 ms) iría a remolque y emborronaría la onda. (Se aplica
    // vía setPaintProperty porque los tipos del literal paint no la admiten.)
    map.setPaintProperty(EFFIS_LAYER_ID, 'raster-opacity-transition', { duration: 0 });
    if (visible) startPulse(map);
  };

  // El protocolo effis-tiles:// (effisTileCache.ts) guarda copia local de
  // cada tesela y la sirve si el servicio falla: por eso la capa puede seguir
  // pintándose durante una caída de EFFIS.
  const tilesUrl = () =>
    `${EFFIS_TILE_PROTOCOL}://${window.location.origin}/api/effis/wms?range=${range}&width=512&height=512&bbox={bbox-epsg-3857}` +
    (epoch > 0 ? `&v=${epoch}` : '');

  // La URL de tiles es inmutable en una fuente raster: recargar o cambiar de
  // rango implica recrear fuente y capa. Se reinserta bajo las capas
  // superiores (límites y focos) para mantener los polígonos debajo.
  const rebuild = (map: MapLibreMap) => {
    stopPulse();
    if (map.getLayer(EFFIS_LAYER_ID)) map.removeLayer(EFFIS_LAYER_ID);
    if (map.getSource(EFFIS_SOURCE_ID)) map.removeSource(EFFIS_SOURCE_ID);
    const beforeId = [MUNICIPALITIES_LAYER_ID, BOUNDARIES_LAYER_ID, FIRES_LAYER_ID].find((id) =>
      map.getLayer(id)
    );
    addSourceAndLayer(map, beforeId);
  };

  return {
    id: EFFIS_LAYER_ID,
    add(map) {
      addSourceAndLayer(map);
    },
    setVisible(map, v) {
      visible = v;
      map.setLayoutProperty(EFFIS_LAYER_ID, 'visibility', v ? 'visible' : 'none');
      if (v) startPulse(map);
      else stopPulse();
    },
    setRange(map, newRange) {
      if (newRange === range) return;
      range = newRange;
      rebuild(map);
    },
    refresh(map) {
      epoch += 1;
      rebuild(map);
    },
  };
}

interface WindArrowProps {
  kind: WindPointKind;
  /** Hacia dónde sopla (la convención "de dónde viene" se resuelve aquí). */
  directionTo: number;
  /** km/h redondeados, listos para la etiqueta. */
  speed: number;
}

const EMPTY_WIND: FeatureCollection<Point, WindArrowProps> = {
  type: 'FeatureCollection',
  features: [],
};

function windToGeoJSON(points: WindPoint[]): FeatureCollection<Point, WindArrowProps> {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        kind: p.kind,
        directionTo: (p.directionFrom + 180) % 360,
        speed: Math.round(p.speedKmh),
      },
    })),
  };
}

/**
 * Variantes de flecha por velocidad: misma punta, asta más larga cuanto más
 * viento. Los umbrales (km/h) siguen a grandes rasgos la escala Beaufort
 * (brisa suave / moderada / fresca / fuerte).
 */
const WIND_SPEED_STEPS = [10, 20, 35] as const;
const WIND_ARROW_IMAGES = ['wind-arrow-l0', 'wind-arrow-l1', 'wind-arrow-l2', 'wind-arrow-l3'];
const WIND_ARROW_LENGTHS = [26, 36, 46, 56]; // px de asta+punta en el canvas de 64

/** Icono según velocidad; lo comparten la flecha ancla y la de barrido. */
const windArrowBySpeed: ExpressionSpecification = [
  'step',
  ['get', 'speed'],
  WIND_ARROW_IMAGES[0],
  WIND_SPEED_STEPS[0],
  WIND_ARROW_IMAGES[1],
  WIND_SPEED_STEPS[1],
  WIND_ARROW_IMAGES[2],
  WIND_SPEED_STEPS[2],
  WIND_ARROW_IMAGES[3],
];

/**
 * Flechas apuntando al norte, dibujadas en canvas y registradas como SDF: un
 * único dibujo que cada capa tinta con icon-color. El volcado con blur no es
 * capricho: MapLibre corta el borde SDF en alfa ≈ 0.75, y sin gradiente de
 * alfa el contorno saldría dentado.
 */
function addWindArrowImages(map: MapLibreMap): void {
  if (map.hasImage(WIND_ARROW_IMAGES[0])) return;
  const size = 64;
  for (const [i, name] of WIND_ARROW_IMAGES.entries()) {
    const length = WIND_ARROW_LENGTHS[i];
    const top = 32 - length / 2;
    const bottom = 32 + length / 2;

    const draw = document.createElement('canvas');
    draw.width = size;
    draw.height = size;
    const ctx = draw.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath(); // asta
    ctx.moveTo(32, bottom);
    ctx.lineTo(32, top + 18);
    ctx.stroke();
    ctx.beginPath(); // punta
    ctx.moveTo(32, top);
    ctx.lineTo(20, top + 22);
    ctx.lineTo(44, top + 22);
    ctx.closePath();
    ctx.fill();

    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const outCtx = out.getContext('2d');
    if (!outCtx) return;
    outCtx.filter = 'blur(1.5px)';
    outCtx.drawImage(draw, 0, 0);
    map.addImage(name, outCtx.getImageData(0, 0, size, size), { sdf: true, pixelRatio: 2 });
  }
}

export interface WindLayer extends AppLayer {
  setData(map: MapLibreMap, points: WindPoint[]): void;
}

/**
 * El barrido de cada flecha representa lo que recorre el humo en este tiempo
 * a la velocidad del viento a 10 m (24 km/h → 6 km). Es deliberadamente
 * conservador: el humo en altura suele viajar aún más rápido.
 */
const SWEEP_HOURS = 0.25;
/**
 * Duración de cada soplido. Constante a propósito: como la distancia crece
 * con los km/h, la velocidad aparente de cada flecha queda proporcional a la
 * real sin ajustar nada más.
 */
const SWEEP_PERIOD_MS = 3000;
/** A partir de aquí la flecha se desvanece hasta reaparecer en el foco. */
const SWEEP_FADE_FROM = 0.7;
const SWEEP_OPACITY = 0.95;

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQ = 111.32;

/** Todo lo precalculable de un soplido; el rAF solo interpola. */
interface SweepSeed {
  lon: number;
  lat: number;
  directionTo: number;
  speed: number;
  /** Desplazamiento total del barrido, en grados. */
  dLon: number;
  dLat: number;
  /** Desfase propio (derivado de la coordenada): soplidos no sincronizados. */
  phaseMs: number;
}

/**
 * Viento actual en tres capas de símbolos (la colisión y el orden de pila
 * son por capa, no por feature):
 * - Rejilla ambiental: flechas sutiles bajo las referencias urbanas, para que
 *   los topónimos ganen la colisión y MapLibre aclare la rejilla en zoom bajo.
 * - Ancla junto a cada foco: flecha cian fija con su "NN km/h", encima de
 *   todo (los símbolos no capturan eventos: el popup de focos no se ve
 *   afectado). La longitud del icono crece con la velocidad.
 * - Barrido: una copia de la flecha "sopla" desde el foco hacia sotavento
 *   recorriendo la distancia del humo en 15 min, y se desvanece. Distancia
 *   geográfica, no de pantalla: al acercar el zoom se ve el alcance real
 *   sobre el terreno. Animación por setData de una fuente GeoJSON minúscula
 *   (≤60 puntos); queda estática con "reducir movimiento" y en pantallas
 *   táctiles (mismo criterio que el latido de EFFIS: el repintado continuo
 *   hace tartamudear el móvil).
 */
export function createWindLayer(): WindLayer {
  let visible = true;
  let sweepFrame: number | null = null;
  let seeds: SweepSeed[] = [];

  const motionOk = () =>
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    !window.matchMedia('(pointer: coarse)').matches;

  const stopSweep = () => {
    if (sweepFrame !== null) {
      cancelAnimationFrame(sweepFrame);
      sweepFrame = null;
    }
  };

  const sweepGeoJSON = (now: number): FeatureCollection<Point, { [k: string]: unknown }> => ({
    type: 'FeatureCollection',
    features: seeds.map((s) => {
      const phase = ((now + s.phaseMs) % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS;
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          // Avance lineal: el humo no acelera ni frena, viaja con el viento.
          coordinates: [s.lon + phase * s.dLon, s.lat + phase * s.dLat],
        },
        properties: {
          directionTo: s.directionTo,
          speed: s.speed,
          opacity:
            phase < SWEEP_FADE_FROM
              ? SWEEP_OPACITY
              : SWEEP_OPACITY * (1 - (phase - SWEEP_FADE_FROM) / (1 - SWEEP_FADE_FROM)),
        },
      };
    }),
  });

  const startSweep = (map: MapLibreMap) => {
    if (sweepFrame !== null || seeds.length === 0 || !motionOk()) return;
    let lastFrame = 0;
    const tick = (now: number) => {
      if (!map.getLayer(WIND_SWEEP_LAYER_ID)) {
        sweepFrame = null;
        return;
      }
      // ~30 fps bastan para un desplazamiento suave, y durante un gesto no se
      // toca la fuente: el repintado ya lo paga el propio movimiento del mapa.
      if (now - lastFrame >= 33 && !map.isMoving()) {
        lastFrame = now;
        const source = map.getSource(WIND_SWEEP_SOURCE_ID) as GeoJSONSource | undefined;
        source?.setData(sweepGeoJSON(now));
      }
      sweepFrame = requestAnimationFrame(tick);
    };
    sweepFrame = requestAnimationFrame(tick);
  };

  const clearSweepSource = (map: MapLibreMap) => {
    const source = map.getSource(WIND_SWEEP_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData({ type: 'FeatureCollection', features: [] });
  };

  return {
    id: WIND_GRID_LAYER_ID,
    add(map) {
      addWindArrowImages(map);
      map.addSource(WIND_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_WIND,
        attribution: 'Viento: <a href="https://open-meteo.com/">Open-Meteo</a>',
      });
      map.addSource(WIND_SWEEP_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer(
        {
          id: WIND_GRID_LAYER_ID,
          type: 'symbol',
          source: WIND_SOURCE_ID,
          filter: ['==', ['get', 'kind'], 'grid' satisfies WindPointKind],
          layout: {
            'icon-image': WIND_ARROW_IMAGES[1],
            'icon-rotate': ['get', 'directionTo'],
            // La flecha es geográfica: fija al norte del mapa, no al de la
            // pantalla (aunque este mapa no rota, el intent queda explícito).
            'icon-rotation-alignment': 'map',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 0.8],
            'icon-padding': 2,
          },
          paint: { 'icon-color': MAP.windGrid },
        },
        CITIES_DOTS_LAYER_ID
      );
      // Barrido bajo el ancla: al reaparecer en el origen queda cubierto por
      // la flecha fija y el reinicio del ciclo no produce un parpadeo.
      map.addLayer({
        id: WIND_SWEEP_LAYER_ID,
        type: 'symbol',
        source: WIND_SWEEP_SOURCE_ID,
        layout: {
          'icon-image': windArrowBySpeed,
          'icon-rotate': ['get', 'directionTo'],
          'icon-rotation-alignment': 'map',
          'icon-size': ['interpolate', ['linear'], ['get', 'speed'], 0, 0.8, 60, 1.05],
          // Sin colisión ni empujar a nadie: una fuente que cambia 30 veces
          // por segundo no puede disputar hueco a las etiquetas.
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': MAP.windFire,
          'icon-opacity': ['get', 'opacity'],
        },
      });
      map.addLayer({
        id: WIND_FIRES_LAYER_ID,
        type: 'symbol',
        source: WIND_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'fire' satisfies WindPointKind],
        layout: {
          'icon-image': windArrowBySpeed,
          'icon-rotate': ['get', 'directionTo'],
          'icon-rotation-alignment': 'map',
          'icon-size': ['interpolate', ['linear'], ['get', 'speed'], 0, 0.8, 60, 1.05],
          'icon-allow-overlap': true,
          // Con aglomeración, el viento más fuerte coloca su etiqueta primero.
          'symbol-sort-key': ['*', -1, ['get', 'speed']],
          'text-field': ['concat', ['to-string', ['get', 'speed']], ' km/h'],
          'text-font': ['Montserrat Regular'],
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 1.1],
          // La flecha siempre se pinta; el texto cede si no cabe.
          'text-optional': true,
          'text-rotation-alignment': 'viewport',
        },
        paint: {
          'icon-color': MAP.windFire,
          'icon-halo-color': MAP.labelHalo,
          'icon-halo-width': 1,
          'text-color': MAP.windLabel,
          'text-halo-color': MAP.labelHalo,
          'text-halo-width': 2,
        },
      });
    },
    setVisible(map, v) {
      visible = v;
      const value = v ? 'visible' : 'none';
      map.setLayoutProperty(WIND_GRID_LAYER_ID, 'visibility', value);
      map.setLayoutProperty(WIND_FIRES_LAYER_ID, 'visibility', value);
      map.setLayoutProperty(WIND_SWEEP_LAYER_ID, 'visibility', value);
      if (v) startSweep(map);
      else stopSweep();
    },
    setData(map, points) {
      const source = map.getSource(WIND_SOURCE_ID) as GeoJSONSource | undefined;
      source?.setData(windToGeoJSON(points));

      seeds = points
        .filter((p) => p.kind === 'fire')
        .map((p) => {
          const directionTo = (p.directionFrom + 180) % 360;
          const rad = (directionTo * Math.PI) / 180;
          const reachKm = p.speedKmh * SWEEP_HOURS;
          return {
            lon: p.lon,
            lat: p.lat,
            directionTo,
            speed: Math.round(p.speedKmh),
            dLon: (reachKm * Math.sin(rad)) / (KM_PER_DEG_LON_EQ * Math.cos((p.lat * Math.PI) / 180)),
            dLat: (reachKm * Math.cos(rad)) / KM_PER_DEG_LAT,
            // Pseudoaleatorio estable por coordenada: mismo desfase entre
            // refrescos, sin soplidos al unísono.
            phaseMs: Math.abs(Math.sin(p.lon * 12.9898 + p.lat * 78.233)) * SWEEP_PERIOD_MS,
          };
        });

      if (seeds.length === 0) {
        stopSweep();
        clearSweepSource(map);
      } else if (visible) {
        startSweep(map);
      }
    },
  };
}
