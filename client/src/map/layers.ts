import type { FeatureCollection, LineString, Point } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { MAP, SEVERITY, type MapPalette, type MapTheme } from '../styles/mapTokens';
import type { EffisRange, FireHotspot, RainForecastPoint, WindPoint } from '../types';
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
const SMOKE_PLUME_SOURCE_ID = 'smoke-plume';
const SMOKE_WISP_SOURCE_ID = 'smoke-wisp';
const WIND_FIRE_SOURCE_ID = 'wind-fire';
const SMOKE_PLUME_LAYER_ID = 'smoke-plume';
const SMOKE_PLUME_EDGE_LAYER_ID = 'smoke-plume-edge';
const SMOKE_WISP_LAYER_ID = 'smoke-wisp';
const WIND_CHEVRON_LAYER_ID = 'wind-chevron';
const WIND_LABEL_LAYER_ID = 'wind-label';
const RAIN_SOURCE_ID = 'rain-forecast';
const RAIN_LAYER_ID = 'rain-forecast-badges';

export type BasemapId = 'satellite' | 'dark' | 'light';

const CARTO_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>';

/**
 * Estilo base con tres fondos raster sin API key, al estilo del visor de FIRMS:
 * - satellite: Esri World Imagery (imagen satelital, nítida a todos los zooms)
 * - dark: CARTO Dark Matter en su variante SIN etiquetas. Las etiquetas van
 *   horneadas en el raster y CARTO las sirve con topónimos anglificados
 *   ("CATALONIA", "SEVILLE"); usamos dark_nolabels y pintamos nuestras propias
 *   etiquetas en castellano como capas de símbolos (CCAA y ciudades).
 * - light: CARTO Positron, mismo criterio (light_nolabels). Existe para el
 *   widget embebible en medios que maquetan en blanco (`/embed?tema=claro`); la
 *   app propia no lo ofrece.
 * Los tres viven en el estilo y setBasemap() alterna su visibilidad, así el
 * cambio de fondo no recrea el mapa ni toca las capas de datos.
 *
 * La paleta entra como parámetro (y no leyendo MAP directamente) porque sobre
 * Positron hay que invertir los contrastes de la cartografía propia: ver
 * MAP_LIGHT en styles/mapTokens.ts.
 */
export function createBaseStyle(palette: MapPalette = MAP): StyleSpecification {
  return {
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
        attribution: CARTO_ATTRIBUTION,
      },
      'carto-light': {
        type: 'raster',
        tiles: ['a', 'b', 'c', 'd'].map(
          (s) => `https://${s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png`
        ),
        tileSize: 256,
        maxzoom: 20,
        attribution: CARTO_ATTRIBUTION,
      },
    },
    layers: [
      // Fondo bajo las teselas: azul océano profundo (o el agua clara de
      // Positron en tema claro). Es lo que asoma mientras una tesela no ha
      // llegado (o si el proveedor falla); sin esto asomaría el blanco por
      // defecto de MapLibre, que es un fogonazo sobre UI oscura.
      { id: 'background', type: 'background', paint: { 'background-color': palette.void } },
      { id: 'basemap-satellite', type: 'raster', source: 'satellite' },
      { id: 'basemap-dark', type: 'raster', source: 'carto-dark', layout: { visibility: 'none' } },
      { id: 'basemap-light', type: 'raster', source: 'carto-light', layout: { visibility: 'none' } },
    ],
  };
}

/**
 * Paleta de la cartografía propia que exige un mapa base. Lo decide el fondo,
 * no la interfaz: sobre Positron hace falta la variante clara (etiquetas y
 * límites oscuros), y sobre satélite u oscuro, la de casa. Ver MAP_LIGHT.
 */
export function paletteThemeFor(basemap: BasemapId): MapTheme {
  return basemap === 'light' ? 'light' : 'dark';
}

export function setBasemap(map: MapLibreMap, basemap: BasemapId): void {
  const visibility = (id: BasemapId) => (basemap === id ? 'visible' : 'none');
  map.setLayoutProperty('basemap-satellite', 'visibility', visibility('satellite'));
  map.setLayoutProperty('basemap-dark', 'visibility', visibility('dark'));
  map.setLayoutProperty('basemap-light', 'visibility', visibility('light'));
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

export function createFiresLayer(palette: MapPalette = MAP): FiresLayer {
  // La misma escala de severidad alimenta la leyenda: un solo sitio que mantener.
  const [low, mid, high, extreme] = SEVERITY;
  return {
    id: FIRES_LAYER_ID,
    add(map) {
      map.addSource(FIRES_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_COLLECTION,
        // El crédito a FIRMS vivía solo en el pie de la sidebar, que el widget
        // embebible no tiene: colgado de la fuente, MapLibre lo enseña en su
        // atribución (el "i") en los dos sitios.
        attribution:
          'Focos: <a href="https://firms.modaps.eosdis.nasa.gov/">NASA FIRMS</a> (VIIRS/MODIS)',
      });
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
          'circle-stroke-color': palette.severityStroke,
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

const RAIN_DROP_IMAGE = 'rain-drop';

/** Gota azul con borde claro, dibujada en canvas (sin asset que servir). */
function addRainDropImage(map: MapLibreMap): void {
  if (map.hasImage(RAIN_DROP_IMAGE)) return;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.beginPath();
  ctx.moveTo(32, 6);
  ctx.quadraticCurveTo(48, 30, 48, 42);
  ctx.arc(32, 42, 16, 0, Math.PI, false);
  ctx.quadraticCurveTo(16, 30, 32, 6);
  ctx.closePath();
  ctx.fillStyle = '#38bdf8';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 4;
  ctx.stroke();
  map.addImage(RAIN_DROP_IMAGE, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

export interface RainLayer extends AppLayer {
  setData(map: MapLibreMap, points: RainForecastPoint[]): void;
}

/**
 * Badges de lluvia prevista sobre incendios grandes: gota + "NN %" junto al
 * cluster. Solo entran puntos con probabilidad ≥ umbral (el filtro vive en la
 * capa: quien llama pasa todos los puntos y el negativo "sin lluvia" se cuenta
 * en el ranking, no en el mapa). Va encima de los focos: son ≤20 símbolos y el
 * dato responde la pregunta más repetida ante un incendio gordo.
 */
export function createRainLayer(minProb: number, palette: MapPalette = MAP): RainLayer {
  return {
    id: RAIN_LAYER_ID,
    add(map) {
      addRainDropImage(map);
      map.addSource(RAIN_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_COLLECTION,
        // El crédito de Open-Meteo ya cuelga de la fuente del viento; repetirlo
        // aquí duplicaría la línea en la atribución del mapa.
      });
      map.addLayer({
        id: RAIN_LAYER_ID,
        type: 'symbol',
        source: RAIN_SOURCE_ID,
        filter: ['>=', ['get', 'probMax'], minProb],
        layout: {
          'icon-image': RAIN_DROP_IMAGE,
          'icon-size': 0.55,
          // Anclada arriba-derecha del cluster para no tapar los círculos de foco.
          'icon-offset': [26, -26],
          'icon-allow-overlap': true,
          'text-field': ['concat', ['to-string', ['get', 'probMax']], ' %'],
          'text-size': 11,
          'text-offset': [2.6, -1.6],
          'text-anchor': 'left',
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#e0f2fe',
          'text-halo-color': palette.labelHalo,
          'text-halo-width': 1.2,
        },
      });
    },
    setVisible(map, visible) {
      map.setLayoutProperty(RAIN_LAYER_ID, 'visibility', visible ? 'visible' : 'none');
    },
    setData(map, points) {
      const source = map.getSource(RAIN_SOURCE_ID) as GeoJSONSource | undefined;
      source?.setData({
        type: 'FeatureCollection',
        features: points.map((p) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: { probMax: Math.round(p.probMax) },
        })),
      });
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
export function createBoundariesLayer(palette: MapPalette = MAP): AppLayer {
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
          'line-color': palette.boundaryMuni,
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.4, 13, 1.1],
        },
      });
      map.addLayer({
        id: PROVINCES_LAYER_ID,
        type: 'line',
        source: PROVINCES_SOURCE_ID,
        minzoom: 6.5,
        paint: {
          'line-color': palette.boundaryProv,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6.5, 0.6, 11, 1.2],
        },
      });
      map.addLayer({
        id: BOUNDARIES_LAYER_ID,
        type: 'line',
        source: BOUNDARIES_SOURCE_ID,
        paint: {
          'line-color': palette.boundaryCcaa,
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
          'text-color': palette.label,
          'text-halo-color': palette.labelHalo,
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
          'text-color': palette.label,
          // Halo oscuro: legible tanto sobre satélite como sobre fondo oscuro.
          'text-halo-color': palette.labelHalo,
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
export function createCitiesLayer(palette: MapPalette = MAP): AppLayer {
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
          'circle-color': palette.cityDot,
          'circle-radius': 2.5,
          'circle-stroke-color': palette.cityDotStroke,
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
          'text-color': palette.label,
          'text-halo-color': palette.labelHalo,
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

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQ = 111.32;
const D2R = Math.PI / 180;

/** Punto a `km` del origen siguiendo el rumbo `bearingDeg` (norte = 0°). */
function dest(lon: number, lat: number, km: number, bearingDeg: number): [number, number] {
  const r = bearingDeg * D2R;
  return [
    lon + (km * Math.sin(r)) / (KM_PER_DEG_LON_EQ * Math.cos(lat * D2R)),
    lat + (km * Math.cos(r)) / KM_PER_DEG_LAT,
  ];
}

/**
 * Horizonte de la pluma: 45 min de recorrido del humo a la velocidad del viento
 * a 10 m. 15 min quedaba diminuto y 1 h invade el mapa con viento fuerte (60
 * km/h = 60 km de cono), pero 30 min también resultó diminuto CON EL VIENTO
 * REAL de Iberia: fuera de un episodio son 4-9 km/h, o sea 2-4,5 km de alcance,
 * que a zoom 9 son 9-19 px. A 45 min el cono se lee a escala regional y a 40
 * km/h sigue cabiendo (30 km).
 */
const PLUME_HOURS = 0.75;

/** El viento flojo esparce, el fuerte encañona. Acotado para que ni el cono
 *  degenere en abanico ni en línea. */
function halfAngle(speedKmh: number): number {
  return Math.max(14, 34 - Math.min(20, speedKmh * 0.52));
}

/**
 * Tres bandas de 15 min de recorrido cada una ([t0, t1] como fracción del
 * alcance). La opacidad decreciente va horneada en el color de cada banda
 * (smokeBand1..3): el alfa ES la dispersión.
 */
const PLUME_BANDS: ReadonlyArray<readonly [number, number]> = [
  [0, 1 / 3],
  [1 / 3, 2 / 3],
  [2 / 3, 1],
];

/**
 * Duración del recorrido de cada trazo. Constante a propósito: como la
 * distancia crece con los km/h, la velocidad aparente de los trazos queda
 * proporcional a la real sin ajustar nada más.
 */
const WISP_PERIOD_MS = 4600;
/**
 * Cuántos trazos por foco. Generoso a propósito: lo que hace que un puñado de
 * rayas se lea como viento —y no como arañazos sueltos— es la densidad.
 */
const wispCount = (speedKmh: number) => Math.min(22, 10 + Math.round(speedKmh / 2.5));

/**
 * Largo del trazo: 18 % del cono, acotado a [10, 40] px de pantalla y, sobre
 * todo, a 0,7 veces el hueco entre trazos consecutivos — si un trazo llega a
 * tocar al siguiente, la fila entera se lee como UNA línea continua en vez de
 * como trazos de viento. La POSICIÓN es geográfica (avanza sobre el terreno);
 * solo el largo se mide en pantalla, misma convención que el campo ambiental:
 * el trazo ambienta, no mide.
 */
const WISP_LENGTH_FRACTION = 0.18;
const WISP_MIN_PX = 10;
const WISP_MAX_PX = 40;

/**
 * Hash estable en [0,1). Hace falta uno de verdad: con el desfase encadenado
 * del prototipo (`seed * 41.7`), trazos consecutivos salían con un desvío
 * lateral casi idéntico —el incremento cae en ~-0,4 rad— y el chorro entero
 * degeneraba en una sola curva por el eje del cono.
 */
function hash01(x: number): number {
  const v = Math.sin(x) * 43758.5453;
  return v - Math.floor(v);
}

/** Metros por píxel de Web Mercator a una latitud y zoom dados. */
function metersPerPixel(zoom: number, lat: number): number {
  return (156543.03392 * Math.cos(lat * D2R)) / Math.pow(2, zoom);
}

const WIND_CHEVRON_IMAGE = 'wind-chevron';

/**
 * Galón `∧` apuntando al norte, registrado como SDF para que la capa lo tinte
 * con icon-color.
 */
function addWindChevronImage(map: MapLibreMap): void {
  if (map.hasImage(WIND_CHEVRON_IMAGE)) return;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(16, 40);
  ctx.lineTo(32, 20);
  ctx.lineTo(48, 40);
  ctx.stroke();
  map.addImage(WIND_CHEVRON_IMAGE, ctx.getImageData(0, 0, size, size), {
    sdf: true,
    pixelRatio: 2,
  });
}

export interface SmokePlumeLayer extends AppLayer {
  setData(map: MapLibreMap, points: WindPoint[]): void;
}

/** Todo lo precalculable de una pluma; el rAF de los trazos solo interpola. */
interface PlumeSeed {
  lon: number;
  lat: number;
  /** Hacia dónde empuja el humo (la convención "de dónde viene" se resuelve aquí). */
  dirTo: number;
  speedKmh: number;
  /** km/h redondeados, listos para la etiqueta. */
  speed: number;
  /** Alcance del humo en 45 min, en km. */
  reachKm: number;
  /** Semiángulo de dispersión, en grados. */
  half: number;
  /** Desfase estable por coordenada: trazos de focos distintos, no al unísono. */
  phase: number;
}

/** Arco del sector a la fracción `t` del alcance, con 9 segmentos. */
function plumeArc(s: PlumeSeed, t: number, reverse: boolean): [number, number][] {
  const out: [number, number][] = [];
  const N = 9;
  for (let i = 0; i <= N; i++) {
    const k = reverse ? N - i : i;
    out.push(dest(s.lon, s.lat, s.reachKm * t, s.dirTo - s.half + (2 * s.half * k) / N));
  }
  return out;
}

/**
 * Pluma de humo: el humo se dispersa en un cono a sotavento y la geometría
 * del cono es a la vez la dirección y la velocidad — largo y estrecho =
 * viento fuerte que lo lleva lejos; corto y abierto = viento flojo que lo
 * deja encima del municipio. Cinco capas sobre tres fuentes:
 * - `smoke-plume` + `smoke-plume-edge`: sector de 45 min en tres bandas de
 *   15, con vértice en el foco. Solo el arco exterior lleva contorno, para
 *   que el cono no se corte en seco. Bajo los círculos de foco: el humo no
 *   puede tapar el dato primario. Distancia geográfica, no de pantalla.
 * - `smoke-wisp`: trazos que nacen en el foco, se apartan del eje al avanzar y
 *   se apagan al alcance. Son rayas orientadas al flujo, no círculos: un punto
 *   difuso se lee como pompa, y una raya es el lenguaje universal del viento.
 *   Única fuente que cambia por frame (≤15 trazos por foco), a ~30 fps en
 *   escritorio y ~20 en táctil; se detiene con "reducir movimiento" y el cono
 *   estático sigue contando dirección y alcance.
 * - `wind-chevron` + `wind-label`: galón de dirección para el zoom de país
 *   (desaparece al acercarse, donde el cono ya es inequívoco) y `NN km/h`
 *   siempre visible, encima de todo (los símbolos no capturan eventos: el
 *   popup de focos no se ve afectado).
 */
export function createSmokePlumeLayer(palette: MapPalette = MAP): SmokePlumeLayer {
  let visible = true;
  let wispFrame: number | null = null;
  let seeds: PlumeSeed[] = [];

  // Solo "reducir movimiento" (preferencia de accesibilidad) desactiva los
  // trazos; en táctil corren, pero a menos fps (ver startWisps).
  const motionOk = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stopWisps = () => {
    if (wispFrame !== null) {
      cancelAnimationFrame(wispFrame);
      wispFrame = null;
    }
  };

  const wispGeoJSON = (
    now: number,
    map: MapLibreMap
  ): FeatureCollection<LineString, { t: number }> => {
    // El largo del trazo se acota en pantalla, así que hace falta la escala del
    // zoom: se calcula una sola vez por frame, no una por trazo.
    const kmPerPx = metersPerPixel(map.getZoom(), map.getCenter().lat) / 1000;
    return {
      type: 'FeatureCollection',
      features: seeds.flatMap((s) => {
        const halfRad = s.half * D2R;
        const n = wispCount(s.speedKmh);
        // La fracción del cono que ocupa el trazo. Los topes en píxeles se
        // traducen a fracción con el largo del cono en pantalla (reachPx), y el
        // hueco entre trazos (1/n) manda sobre todos: sin ese tope se sueldan.
        const reachPx = s.reachKm / kmPerPx;
        const streakFrac =
          reachPx > 0
            ? Math.max(
                Math.min(WISP_LENGTH_FRACTION, WISP_MAX_PX / reachPx, 0.7 / n),
                Math.min(WISP_MIN_PX / reachPx, 0.5)
              )
            : 0;
        return Array.from({ length: n }, (_, i) => {
          const t = (now / WISP_PERIOD_MS + s.phase + i / n) % 1;
          // Cada trazo lleva su propio carril en [-1,1]: se aparta del eje al
          // avanzar (la divergencia crece con t) por su lado, no todos al mismo.
          const lane = hash01(s.phase * 311.7 + i * 127.1) * 2 - 1;
          // La divergencia crece con la RAÍZ de t, no con t: con t los trazos
          // se pegan al eje en el primer tercio y el cono se ve hueco por los
          // lados. El tope al final del recorrido es el mismo.
          const wanderRad = (tt: number) =>
            lane * Math.sqrt(tt) * halfRad * 0.85 +
            // Vaivén suave para que el trazo no sea una recta perfecta.
            Math.sin(tt * 3.3 + lane * 6.283) * tt * halfRad * 0.12;
          const at = (tt: number) =>
            dest(s.lon, s.lat, s.reachKm * tt, s.dirTo + wanderRad(tt) / D2R);
          // La cola nunca queda por detrás del foco.
          const tailT = Math.max(0, t - streakFrac);
          // Tres puntos: al heredar la divergencia, el trazo sale curvado.
          return {
            type: 'Feature' as const,
            geometry: {
              type: 'LineString' as const,
              coordinates: [at(tailT), at((tailT + t) / 2), at(t)],
            },
            properties: { t },
          };
        });
      }),
    };
  };

  const startWisps = (map: MapLibreMap) => {
    if (wispFrame !== null || seeds.length === 0 || !motionOk()) return;
    // ~30 fps bastan; en táctil se baja a ~20: cada frame repinta el canvas
    // entero y así se recorta ese coste (y la batería) sin que se note.
    const frameMs = window.matchMedia('(pointer: coarse)').matches ? 50 : 33;
    let lastFrame = 0;
    const tick = (now: number) => {
      if (!map.getLayer(SMOKE_WISP_LAYER_ID)) {
        wispFrame = null;
        return;
      }
      // Durante un gesto no se toca la fuente: el repintado ya lo paga el
      // propio movimiento del mapa.
      if (now - lastFrame >= frameMs && !map.isMoving()) {
        lastFrame = now;
        const source = map.getSource(SMOKE_WISP_SOURCE_ID) as GeoJSONSource | undefined;
        source?.setData(wispGeoJSON(now, map));
      }
      wispFrame = requestAnimationFrame(tick);
    };
    wispFrame = requestAnimationFrame(tick);
  };

  const clearWispSource = (map: MapLibreMap) => {
    const source = map.getSource(SMOKE_WISP_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData({ type: 'FeatureCollection', features: [] });
  };

  return {
    id: SMOKE_PLUME_LAYER_ID,
    add(map) {
      addWindChevronImage(map);
      map.addSource(SMOKE_PLUME_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource(SMOKE_WISP_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource(WIND_FIRE_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        attribution: 'Viento: <a href="https://open-meteo.com/">Open-Meteo</a>',
      });

      // Las tres capas de humo van bajo los círculos de foco: el humo no
      // puede tapar el dato primario.
      map.addLayer(
        {
          id: SMOKE_PLUME_LAYER_ID,
          type: 'fill',
          source: SMOKE_PLUME_SOURCE_ID,
          paint: {
            // El alfa de cada banda va horneado en su token (el alfa
            // decreciente ES la dispersión), por eso aquí no hay fill-opacity
            // por banda: aplicarla encima lo duplicaría.
            'fill-color': [
              'match',
              ['get', 'band'],
              0,
              palette.smokeBand1,
              1,
              palette.smokeBand2,
              palette.smokeBand3,
            ],
          },
        },
        FIRES_LAYER_ID
      );
      // Solo el arco exterior de la banda 3, para que el cono no se corte en
      // seco.
      map.addLayer(
        {
          id: SMOKE_PLUME_EDGE_LAYER_ID,
          type: 'line',
          source: SMOKE_PLUME_SOURCE_ID,
          filter: ['==', ['get', 'band'], 2],
          paint: {
            'line-color': palette.smokeEdge,
            'line-opacity': 1,
            'line-width': 1,
            'line-blur': 1.5,
          },
        },
        FIRES_LAYER_ID
      );
      map.addLayer(
        {
          id: SMOKE_WISP_LAYER_ID,
          type: 'line',
          source: SMOKE_WISP_SOURCE_ID,
          layout: { 'line-cap': 'round' },
          paint: {
            'line-color': palette.smokeWisp,
            // Fino al nacer y más ancho al dispersarse: es humo expandiéndose,
            // no una partícula viajando. Grueso de verdad, porque el trazo se
            // dibuja SOBRE el cono y ambos son cian: a un pelo de 1 px no le
            // queda contraste contra su propio relleno.
            'line-width': ['interpolate', ['linear'], ['get', 't'], 0, 1.2, 1, 2.8],
            'line-opacity': [
              'interpolate',
              ['linear'],
              ['get', 't'],
              0,
              0,
              0.12,
              0.9,
              0.7,
              0.42,
              1,
              0,
            ],
            'line-blur': 0.6,
          },
        },
        FIRES_LAYER_ID
      );
      // Ancla la dirección cuando el cono es pequeño (zoom de país, viento
      // flojo); desaparece al acercarse, donde el cono ya es inequívoco.
      map.addLayer({
        id: WIND_CHEVRON_LAYER_ID,
        type: 'symbol',
        source: WIND_FIRE_SOURCE_ID,
        maxzoom: 8.5,
        layout: {
          'icon-image': WIND_CHEVRON_IMAGE,
          'icon-rotate': ['get', 'dirTo'],
          'icon-rotation-alignment': 'map',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 8.5, 0.72],
          'icon-allow-overlap': true,
        },
        paint: { 'icon-color': palette.windChevron, 'icon-opacity': 0.95 },
      });
      map.addLayer({
        id: WIND_LABEL_LAYER_ID,
        type: 'symbol',
        source: WIND_FIRE_SOURCE_ID,
        layout: {
          'text-field': ['concat', ['to-string', ['get', 'speed']], ' km/h'],
          'text-font': ['Montserrat Regular'],
          'text-size': 11,
          // Con plumas apuntando en direcciones distintas, la etiqueta debe
          // poder escaparse al lado libre en vez de caer siempre sobre el cono.
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': 1.1,
          // La etiqueta siempre está; cede solo por colisión.
          'text-optional': true,
          // Con aglomeración, gana el viento más fuerte.
          'symbol-sort-key': ['*', -1, ['get', 'speed']],
          'text-rotation-alignment': 'viewport',
        },
        paint: {
          'text-color': palette.windLabel,
          'text-halo-color': palette.labelHalo,
          'text-halo-width': 2,
        },
      });
    },
    setVisible(map, v) {
      visible = v;
      const value = v ? 'visible' : 'none';
      for (const id of [
        SMOKE_PLUME_LAYER_ID,
        SMOKE_PLUME_EDGE_LAYER_ID,
        SMOKE_WISP_LAYER_ID,
        WIND_CHEVRON_LAYER_ID,
        WIND_LABEL_LAYER_ID,
      ]) {
        map.setLayoutProperty(id, 'visibility', value);
      }
      if (v) startWisps(map);
      else {
        stopWisps();
        clearWispSource(map);
      }
    },
    setData(map, points) {
      seeds = points.map((p) => {
        const speedKmh = p.speedKmh;
        return {
          lon: p.lon,
          lat: p.lat,
          dirTo: (p.directionFrom + 180) % 360,
          speedKmh,
          speed: Math.round(speedKmh),
          reachKm: speedKmh * PLUME_HOURS,
          half: halfAngle(speedKmh),
          phase: Math.abs(Math.sin(p.lon * 12.9898 + p.lat * 78.233)),
        };
      });

      // Los sectores y los anclajes son estáticos: se reconstruyen solo aquí,
      // nunca por frame.
      const polys = seeds.flatMap((s) =>
        PLUME_BANDS.map(([t0, t1], band) => {
          const outer = plumeArc(s, t1, false);
          return {
            type: 'Feature' as const,
            geometry: {
              type: 'Polygon' as const,
              coordinates: [
                [
                  ...outer,
                  // Banda 1: el arco interior degenera en el vértice (el foco).
                  ...(t0 === 0 ? [[s.lon, s.lat] as [number, number]] : plumeArc(s, t0, true)),
                  outer[0], // cierre explícito del anillo
                ],
              ],
            },
            properties: { band },
          };
        })
      );
      const plume = map.getSource(SMOKE_PLUME_SOURCE_ID) as GeoJSONSource | undefined;
      plume?.setData({ type: 'FeatureCollection', features: polys });

      const fire = map.getSource(WIND_FIRE_SOURCE_ID) as GeoJSONSource | undefined;
      fire?.setData({
        type: 'FeatureCollection',
        features: seeds.map((s) => ({
          type: 'Feature',
          // El galón vive fuera del círculo del foco, a sotavento.
          geometry: {
            type: 'Point',
            coordinates: dest(s.lon, s.lat, Math.max(1.2, s.reachKm * 0.14), s.dirTo),
          },
          properties: { dirTo: s.dirTo, speed: s.speed },
        })),
      });

      if (seeds.length === 0) {
        stopWisps();
        clearWispSource(map);
      } else if (visible) {
        startWisps(map);
      }
    },
  };
}
