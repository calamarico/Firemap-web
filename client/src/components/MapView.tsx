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
  EffisLayer,
  FIRES_LAYER_ID,
  FiresLayer,
  setBasemap,
} from '../map/layers';
import type { FireHotspot } from '../types';
import FirePopup from './FirePopup';

interface MapViewProps {
  hotspots: FireHotspot[];
  showFires: boolean;
  /** Ya combinado con la disponibilidad real de EFFIS (lo decide App). */
  showEffis: boolean;
  showBoundaries: boolean;
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
  };
}

export default function MapView({
  hotspots,
  showFires,
  showEffis,
  showBoundaries,
  basemap,
  onMapReady,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const layersRef = useRef<{ fires: FiresLayer; effis: EffisLayer; boundaries: AppLayer } | null>(
    null
  );
  const [mapReady, setMapReady] = useState(false);

  // Inicialización única del mapa; los cambios posteriores se sincronizan en
  // los efectos de abajo (por eso este efecto no depende de las props).
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: MAP_CENTER,
      zoom: INITIAL_ZOOM,
      // Limita el paneo al entorno de España (con margen para Canarias): no
      // se piden tiles del resto del mundo que nadie va a mirar.
      maxBounds: [
        [-21, 25.5],
        [7.5, 46.5],
      ],
    });
    // Zoom abajo a la derecha: la esquina superior derecha la ocupa el panel
    // de localidades afectadas.
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-right');

    const fires = createFiresLayer();
    const effis = createEffisLayer('7d');
    const boundaries = createBoundariesLayer();
    const cities = createCitiesLayer();
    layersRef.current = { fires, effis, boundaries };

    map.on('load', () => {
      effis.add(map); // polígonos de área quemada al fondo...
      boundaries.add(map); // ...límites y nombres autonómicos encima...
      cities.add(map); // ...referencias urbanas (sin toggle: son "mobiliario base")...
      fires.add(map); // ...y los focos arriba del todo
      bindFiresPopup(map);
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
    if (!mapReady || !mapRef.current || !layersRef.current) return;
    layersRef.current.boundaries.setVisible(mapRef.current, showBoundaries);
  }, [showBoundaries, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    setBasemap(mapRef.current, basemap);
  }, [basemap, mapReady]);

  return (
    <div ref={containerRef} className="h-full w-full" aria-label="Mapa de focos de calor en España" />
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
