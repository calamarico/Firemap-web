import type maplibregl from 'maplibre-gl';
import { useCallback, useRef, useState } from 'react';
import ImpactPanel from './components/ImpactPanel';
import MapView from './components/MapView';
import Sidebar from './components/Sidebar';
import { REFRESH_INTERVAL_MS } from './config';
import { useEffisStatus } from './hooks/useEffisStatus';
import { useFires } from './hooks/useFires';
import { findLocalityCenter, getLocalityParam, setLocalityParam } from './lib/locality';
import type { BasemapId } from './map/layers';
import type { MunicipalityImpact } from './types';

export default function App() {
  const [showFires, setShowFires] = useState(true);
  const [showEffis, setShowEffis] = useState(true);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [basemap, setBasemapId] = useState<BasemapId>('satellite');

  const { view: fires, refresh: refreshFires } = useFires(REFRESH_INTERVAL_MS);
  const { view: effis, refresh: refreshEffis } = useEffisStatus(REFRESH_INTERVAL_MS);

  const handleRefresh = useCallback(() => {
    refreshFires();
    refreshEffis();
  }, [refreshFires, refreshEffis]);

  const mapRef = useRef<maplibregl.Map | null>(null);
  const handleMapReady = useCallback((map: maplibregl.Map) => {
    mapRef.current = map;

    // Deep link ?localidad=Nombre: vuela al municipio al abrir la página.
    // Gana al hash de posición (#map=...) si vienen los dos.
    const locality = getLocalityParam();
    if (locality) {
      void findLocalityCenter(locality).then((center) => {
        if (center) {
          map.flyTo({ center, zoom: 12, duration: 1800 });
          setLocalityParam(locality); // fija también el título del documento
        } else {
          setLocalityParam(null); // nombre desconocido: se limpia la URL
        }
      });
    }

    // Si el usuario mueve el mapa por su cuenta, el parámetro deja de
    // describir lo que se ve: se retira (el hash sí sigue la vista).
    const clearParam = () => setLocalityParam(null);
    map.on('dragstart', clearParam);
    map.on('zoomstart', (event) => {
      if (event.originalEvent) clearParam();
    });
  }, []);

  // Vuela hasta encuadrar los focos de la localidad elegida en el ranking.
  const handleSelectMunicipality = useCallback((muni: MunicipalityImpact) => {
    if (!mapRef.current || !muni.bbox) return;
    const [minLon, minLat, maxLon, maxLat] = muni.bbox;
    mapRef.current.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      // maxZoom acota el caso de un municipio con 2 focos pegados, donde el
      // bbox es casi un punto y fitBounds se iría a zoom de calle.
      { padding: 80, maxZoom: 12.5, duration: 1400 }
    );
    // La URL queda lista para compartir: ?localidad=Nombre (+ hash de vista).
    setLocalityParam(muni.name);
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView
        hotspots={fires.data?.hotspots ?? []}
        showFires={showFires}
        // La capa se mantiene aunque EFFIS esté caído: el proxy sirve los
        // últimos tiles buenos (stale hasta 24 h) y lo que falte queda vacío.
        showEffis={showEffis}
        showBoundaries={showBoundaries}
        basemap={basemap}
        onMapReady={handleMapReady}
      />
      <Sidebar
        fires={fires}
        effis={effis}
        impact={fires.data?.impact ?? []}
        onSelectMunicipality={handleSelectMunicipality}
        showFires={showFires}
        onShowFiresChange={setShowFires}
        showEffis={showEffis}
        onShowEffisChange={setShowEffis}
        showBoundaries={showBoundaries}
        onShowBoundariesChange={setShowBoundaries}
        basemap={basemap}
        onBasemapChange={setBasemapId}
        onRefresh={handleRefresh}
      />
      <ImpactPanel
        impact={fires.data?.impact ?? []}
        onSelectMunicipality={handleSelectMunicipality}
      />
    </div>
  );
}
