import type { FeatureCollection, Point } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { FRP_SCALE } from '../config';
import type { EffisRange, FireHotspot } from '../types';

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
  // La misma escala FRP alimenta la leyenda: un solo sitio que mantener.
  const [low, mid, high, extreme] = FRP_SCALE;
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
            low.upTo ?? 5,
            mid.color,
            mid.upTo ?? 20,
            high.color,
            high.upTo ?? 50,
            extreme.color,
          ],
          'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'frp'], 0], 0, 5, 50, 11],
          'circle-opacity': 0.85,
          'circle-stroke-color': '#ffffff',
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
          'line-color': 'rgba(226, 232, 240, 0.22)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.4, 13, 1.1],
        },
      });
      map.addLayer({
        id: PROVINCES_LAYER_ID,
        type: 'line',
        source: PROVINCES_SOURCE_ID,
        minzoom: 6.5,
        paint: {
          'line-color': 'rgba(226, 232, 240, 0.35)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6.5, 0.6, 11, 1.2],
        },
      });
      map.addLayer({
        id: BOUNDARIES_LAYER_ID,
        type: 'line',
        source: BOUNDARIES_SOURCE_ID,
        paint: {
          'line-color': 'rgba(226, 232, 240, 0.55)',
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
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
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
          'text-color': '#ffffff',
          // Halo oscuro: legible tanto sobre satélite como sobre fondo oscuro.
          'text-halo-color': '#000000',
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
          'circle-color': 'rgba(226, 232, 240, 0.9)',
          'circle-radius': 2.5,
          'circle-stroke-color': 'rgba(15, 23, 42, 0.7)',
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
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
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
    // Accesibilidad: con "reducir movimiento" activo, la capa queda estática.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const tick = (now: number) => {
      if (!map.getLayer(EFFIS_LAYER_ID)) {
        pulseFrame = null;
        return;
      }
      const phase = 0.5 + 0.5 * Math.sin((now / PULSE_PERIOD_MS) * 2 * Math.PI);
      map.setPaintProperty(
        EFFIS_LAYER_ID,
        'raster-opacity',
        PULSE_MIN + (PULSE_MAX - PULSE_MIN) * phase
      );
      pulseFrame = requestAnimationFrame(tick);
    };
    pulseFrame = requestAnimationFrame(tick);
  };

  const addSourceAndLayer = (map: MapLibreMap, beforeId?: string) => {
    map.addSource(EFFIS_SOURCE_ID, {
      type: 'raster',
      tiles: [tilesUrl()],
      tileSize: 256,
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

  const tilesUrl = () =>
    `${window.location.origin}/api/effis/wms?range=${range}&width=256&height=256&bbox={bbox-epsg-3857}`;

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
      // La URL de tiles es inmutable en una fuente raster: se recrea la fuente.
      // Se reinserta bajo las capas superiores (límites y focos) para mantener
      // los polígonos debajo.
      stopPulse();
      if (map.getLayer(EFFIS_LAYER_ID)) map.removeLayer(EFFIS_LAYER_ID);
      if (map.getSource(EFFIS_SOURCE_ID)) map.removeSource(EFFIS_SOURCE_ID);
      const beforeId = [MUNICIPALITIES_LAYER_ID, BOUNDARIES_LAYER_ID, FIRES_LAYER_ID].find((id) =>
        map.getLayer(id)
      );
      addSourceAndLayer(map, beforeId);
    },
  };
}
