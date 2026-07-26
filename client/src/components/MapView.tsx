import maplibregl, { MapMouseEvent } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { INITIAL_ZOOM, MAP_CENTER } from '../config';
import {
  AppLayer,
  BASE_STYLE,
  BasemapId,
  createBoundariesLayer,
  createCitiesLayer,
  createEffisLayer,
  createFiresLayer,
  createSmokePlumeLayer,
  EffisLayer,
  FIRES_LAYER_ID,
  FiresLayer,
  setBasemap,
  SmokePlumeLayer,
} from '../map/layers';
import type { FireHotspot, WindPoint } from '../types';
import FirePopup from './FirePopup';

interface MapViewProps {
  hotspots: FireHotspot[];
  showFires: boolean;
  /** Ya combinado con la disponibilidad real de EFFIS (lo decide App). */
  showEffis: boolean;
  /**
   * Contador que App incrementa cuando EFFIS pasa de caído a disponible:
   * cada incremento recarga los tiles de la capa (MapLibre no reintenta
   * tiles por sí solo, y el navegador cachearía los de la caída).
   */
  effisRefreshToken?: number;
  showBoundaries: boolean;
  showWind: boolean;
  /** Muestras de viento junto a los focos (useWind). */
  wind: WindPoint[];
  basemap: BasemapId;
  /** Entrega la instancia del mapa a App (para vuelos desde el ranking, etc.). */
  onMapReady?: (map: maplibregl.Map) => void;
}

/** Convierte las properties del feature (tipadas como unknown) en un FireHotspot. */
function propertiesToHotspot(props: Record<string, unknown>): FireHotspot {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    latitude: numOrNull(props.latitude) ?? 0,
    longitude: numOrNull(props.longitude) ?? 0,
    acqDate: str(props.acqDate),
    acqTime: str(props.acqTime),
    satellite: str(props.satellite),
    instrument: str(props.instrument),
    confidence: str(props.confidence),
    frp: numOrNull(props.frp),
    detections: numOrNull(props.detections) ?? undefined,
  };
}

/**
 * Sincronización de la posición con la URL (#map=zoom/lat/lon, mismo formato
 * que el hash nativo de MapLibre para no romper enlaces ya compartidos).
 * A diferencia del hash nativo, la URL se mantiene limpia en la vista
 * inicial: solo se escribe cuando la posición deja de ser la de arranque.
 */
const MAP_HASH_RE = /^#map=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/;

function parseMapHash(): { center: [number, number]; zoom: number } | null {
  const match = MAP_HASH_RE.exec(window.location.hash);
  if (!match) return null;
  const zoom = Number(match[1]);
  const lat = Number(match[2]);
  const lon = Number(match[3]);
  if (![zoom, lat, lon].every(Number.isFinite)) return null;
  return { center: [lon, lat], zoom };
}

function formatMapHash(map: maplibregl.Map): string {
  const center = map.getCenter();
  return `#map=${map.getZoom().toFixed(2)}/${center.lat.toFixed(4)}/${center.lng.toFixed(4)}`;
}

export default function MapView({
  hotspots,
  showFires,
  showEffis,
  effisRefreshToken = 0,
  showBoundaries,
  showWind,
  wind,
  basemap,
  onMapReady,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const layersRef = useRef<{
    fires: FiresLayer;
    effis: EffisLayer;
    boundaries: AppLayer;
    wind: SmokePlumeLayer;
  } | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Inicialización única del mapa; los cambios posteriores se sincronizan en
  // los efectos de abajo (por eso este efecto no depende de las props).
  useEffect(() => {
    if (!containerRef.current) return;
    // Si la URL trae posición (#map=...), el mapa arranca ahí.
    const fromHash = parseMapHash();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: fromHash?.center ?? MAP_CENTER,
      zoom: fromHash?.zoom ?? INITIAL_ZOOM,
      // Limita el paneo al entorno de España (con margen para Canarias): no
      // se piden tiles del resto del mundo que nadie va a mirar. El borde sur
      // queda justo bajo Canarias (27.4°N): más abajo solo hay océano y Sáhara.
      maxBounds: [
        [-21, 26.6],
        [7.5, 46.5],
      ],
      // Sin esto se puede alejar hasta que el encuadre desborda maxBounds por
      // arriba y por abajo a la vez, y ahí se ve lo que haya fuera (África, el
      // Atlántico... o el hueco de una tesela sin cargar).
      minZoom: 5,
      // A z17 el satélite de Esri ya da ~1 m/px: más profundidad solo
      // multiplica teselas (cada nivel duplica las peticiones por pantalla).
      maxZoom: 17,
      // Sin fundido al llegar cada tesela: con el fade de 300 ms por defecto
      // los huecos blancos se ven aunque el dato ya esté descargado.
      fadeDuration: 0,
      // Mapa 2D puro: sin rotación ni pitch se evitan gestos accidentales
      // caros (y en un mapa de incendios no aportan nada).
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    map.touchZoomRotate.disableRotation();
    // Zoom abajo a la derecha: la esquina superior derecha la ocupa el panel
    // de localidades afectadas.
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-right');

    const fires = createFiresLayer();
    const effis = createEffisLayer('7d');
    const boundaries = createBoundariesLayer();
    const cities = createCitiesLayer();
    const wind = createSmokePlumeLayer();
    layersRef.current = { fires, effis, boundaries, wind };

    map.on('load', () => {
      effis.add(map); // polígonos de área quemada al fondo...
      boundaries.add(map); // ...límites y nombres autonómicos encima...
      cities.add(map); // ...referencias urbanas (sin toggle: son "mobiliario base")...
      fires.add(map); // ...los focos arriba...
      // ...y el viento el último: las plumas de humo se auto-insertan bajo
      // los círculos de foco; galón y etiqueta quedan encima de todo.
      wind.add(map);
      bindFiresPopup(map);

      // La URL solo refleja la posición cuando ya no es la de arranque (o si
      // el usuario llegó con hash): la portada queda con URL limpia.
      const initialHash = formatMapHash(map);
      map.on('moveend', () => {
        const hash = formatMapHash(map);
        if (hash === initialHash && !window.location.hash) return;
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}${hash}`
        );
      });

      setMapReady(true);
      onMapReady?.(map);
    });

    mapRef.current = map;
    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !layersRef.current) return;
    layersRef.current.fires.setData(mapRef.current, hotspots);
  }, [hotspots, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !layersRef.current) return;
    layersRef.current.fires.setVisible(mapRef.current, showFires);
  }, [showFires, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !layersRef.current) return;
    layersRef.current.effis.setVisible(mapRef.current, showEffis);
  }, [showEffis, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !layersRef.current || effisRefreshToken === 0) return;
    layersRef.current.effis.refresh(mapRef.current);
  }, [effisRefreshToken, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !layersRef.current) return;
    layersRef.current.boundaries.setVisible(mapRef.current, showBoundaries);
  }, [showBoundaries, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !layersRef.current) return;
    layersRef.current.wind.setData(mapRef.current, wind);
  }, [wind, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !layersRef.current) return;
    layersRef.current.wind.setVisible(mapRef.current, showWind);
  }, [showWind, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    setBasemap(mapRef.current, basemap);
  }, [basemap, mapReady]);

  return (
    // Mismo azul océano que la capa background del estilo: cubre el instante
    // inicial, antes de que el estilo del mapa exista.
    <div
      ref={containerRef}
      className="h-full w-full bg-void"
      aria-label="Mapa de focos de calor en España y Portugal"
    />
  );
}

function bindFiresPopup(map: maplibregl.Map) {
  map.on('click', FIRES_LAYER_ID, (event: MapMouseEvent) => {
    const feature = map.queryRenderedFeatures(event.point, { layers: [FIRES_LAYER_ID] })[0];
    if (!feature || feature.geometry.type !== 'Point') return;

    const fire = propertiesToHotspot(feature.properties as Record<string, unknown>);
    const container = document.createElement('div');
    const root = createRoot(container);
    root.render(<FirePopup fire={fire} />);

    new maplibregl.Popup({ maxWidth: '320px' })
      .setLngLat(feature.geometry.coordinates as [number, number])
      .setDOMContent(container)
      .addTo(map)
      // El unmount se difiere: React no permite desmontar de forma síncrona
      // desde un handler que puede dispararse durante un render.
      .on('close', () => window.setTimeout(() => root.unmount(), 0));
  });

  map.on('mouseenter', FIRES_LAYER_ID, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', FIRES_LAYER_ID, () => {
    map.getCanvas().style.cursor = '';
  });
}
