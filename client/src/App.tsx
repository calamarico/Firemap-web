import type maplibregl from 'maplibre-gl';
import { useCallback, useRef, useState } from 'react';
import ImpactPanel from './components/ImpactPanel';
import MapView from './components/MapView';
import Sidebar from './components/Sidebar';
import { REFRESH_INTERVAL_MS } from './config';
import { useEffisStatus } from './hooks/useEffisStatus';
import { useFires } from './hooks/useFires';
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
