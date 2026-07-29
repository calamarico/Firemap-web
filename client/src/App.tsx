import type maplibregl from 'maplibre-gl';
import { useCallback, useRef, useState } from 'react';
import ImpactPanel from './components/ImpactPanel';
import LayerChips from './components/LayerChips';
import MapView from './components/MapView';
import Sidebar from './components/Sidebar';
import { REFRESH_INTERVAL_MS } from './config';
import { useFireMapData } from './hooks/useFireMapData';
import {
  findLocalityByName,
  findLocalityBySlug,
  getLocalityParam,
  getLocalitySlug,
  setLocalityParam,
} from './lib/locality';
import type { BasemapId } from './map/layers';
import type { MunicipalityImpact } from './types';

export default function App() {
  const [showFires, setShowFires] = useState(true);
  const [showEffis, setShowEffis] = useState(true);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [showWind, setShowWind] = useState(true);
  // Encendido por defecto (decisión de producto 2026-07-27): el coste es
  // asumible —109,2 llamadas ponderadas por refresco de 30 min sobre el cupo
  // de 10.000/día de la IP del propio visitante— y apagarlo sigue cortando
  // toda descarga. (En el widget embebible arranca apagado: ver lib/embed.ts.)
  const [showWindField, setShowWindField] = useState(true);
  const [basemap, setBasemapId] = useState<BasemapId>('satellite');

  const { fires, effis, wind, windField, effisRefreshToken, reducedMotion, refresh } =
    useFireMapData({
      refreshMs: REFRESH_INTERVAL_MS,
      showWind,
      showWindField,
    });

  const mapRef = useRef<maplibregl.Map | null>(null);
  const handleMapReady = useCallback((map: maplibregl.Map) => {
    mapRef.current = map;

    // Deep link por localidad: /incendios/<slug> (canónico) o ?localidad=Nombre
    // (legacy, migra al path al resolverse). Gana al hash (#map=...) si vienen
    // los dos.
    const slug = getLocalitySlug();
    const legacyName = slug ? null : getLocalityParam();
    if (slug || legacyName) {
      const lookup = slug ? findLocalityBySlug(slug) : findLocalityByName(legacyName ?? '');
      void lookup.then((hit) => {
        if (hit) {
          map.flyTo({ center: hit.center, zoom: 12, duration: 1800 });
          setLocalityParam(hit.name, hit.slug); // fija URL canónica y título
        } else {
          setLocalityParam(null); // localidad desconocida: se limpia la URL
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
    // La URL queda lista para compartir: /incendios/<slug> (+ hash de vista).
    setLocalityParam(muni.name, muni.slug);
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView
        hotspots={fires.data?.hotspots ?? []}
        showFires={showFires}
        // La capa sigue visible con EFFIS caído: el protocolo effis-tiles
        // pinta la copia local guardada en el navegador (y en ese estado no
        // lanza peticiones, así que la caída no gasta invocaciones).
        showEffis={showEffis}
        effisRefreshToken={effisRefreshToken}
        showBoundaries={showBoundaries}
        showWind={showWind}
        wind={wind}
        showWindField={showWindField && !reducedMotion}
        windField={windField}
        basemap={basemap}
        onMapReady={handleMapReady}
      />
      {/* Overlay superior, solo móvil: dos cosas que se peleaban por la misma
          esquina, ahora apiladas en columna — los controles de capa (que dentro
          de la hoja plegada nadie encontraba) y el aviso de primera carga.
          pointer-events-none en el contenedor: la banda ocupa todo el ancho,
          pero solo la fila de chips y el aviso capturan el dedo; el resto sigue
          siendo mapa. */}
      <div className="pointer-events-none absolute inset-x-2 top-2 z-panel flex flex-col gap-2 md:hidden">
        <LayerChips
          showFires={showFires}
          onShowFiresChange={setShowFires}
          showEffis={showEffis}
          onShowEffisChange={setShowEffis}
          showBoundaries={showBoundaries}
          onShowBoundariesChange={setShowBoundaries}
          showWind={showWind}
          onShowWindChange={setShowWind}
          showWindField={showWindField}
          onShowWindFieldChange={setShowWindField}
          reducedMotion={reducedMotion}
        />
        {/* La única pista de espera era el spinner diminuto de la barra
            plegada. Va DEBAJO de los chips para que su aparición y su marcha no
            los desplacen. */}
        {fires.status === 'loading' && !fires.data && (
          <div
            role="status"
            className="pointer-events-auto flex items-center gap-2 self-end rounded-lg
              bg-surface-panel px-3 py-2 text-sm text-ink-secondary shadow-panel backdrop-blur"
          >
            <span
              aria-hidden="true"
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2
                border-current border-t-transparent text-ink-muted"
            />
            Cargando datos…
          </div>
        )}
      </div>
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
        showWind={showWind}
        onShowWindChange={setShowWind}
        showWindField={showWindField}
        onShowWindFieldChange={setShowWindField}
        reducedMotion={reducedMotion}
        basemap={basemap}
        onBasemapChange={setBasemapId}
        onRefresh={refresh}
      />
      <ImpactPanel
        impact={fires.data?.impact ?? []}
        onSelectMunicipality={handleSelectMunicipality}
      />
    </div>
  );
}
