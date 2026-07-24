import { useCallback, useState } from 'react';
import ImpactPanel from './components/ImpactPanel';
import MapView from './components/MapView';
import Sidebar from './components/Sidebar';
import { REFRESH_INTERVAL_MS } from './config';
import { useEffisStatus } from './hooks/useEffisStatus';
import { useFires } from './hooks/useFires';
import type { BasemapId } from './map/layers';

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
      />
      <Sidebar
        fires={fires}
        effis={effis}
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
      <ImpactPanel impact={fires.data?.impact ?? []} />
    </div>
  );
}
