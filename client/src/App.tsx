import type maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ImpactPanel from './components/ImpactPanel';
import LayerChips from './components/LayerChips';
import MapView from './components/MapView';
import Sidebar from './components/Sidebar';
import { REFRESH_INTERVAL_MS } from './config';
import { useEffisStatus } from './hooks/useEffisStatus';
import { useFires } from './hooks/useFires';
import { useWind } from './hooks/useWind';
import { useWindField } from './hooks/useWindField';
import {
  findLocalityByName,
  findLocalityBySlug,
  getLocalityParam,
  getLocalitySlug,
  setLocalityParam,
} from './lib/locality';
import { deriveFireWindSites } from './lib/windPoints';
import { setEffisDown } from './map/effisTileCache';
import type { BasemapId } from './map/layers';
import type { MunicipalityImpact } from './types';

export default function App() {
  const [showFires, setShowFires] = useState(true);
  const [showEffis, setShowEffis] = useState(true);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [showWind, setShowWind] = useState(true);
  // Contexto, no dato primario — y cuesta cupo de API: apagado por defecto.
  const [showWindField, setShowWindField] = useState(false);
  const [basemap, setBasemapId] = useState<BasemapId>('satellite');

  // El campo de flujo ES movimiento: con "reducir movimiento" no queda nada
  // que enseñar, así que el interruptor se deshabilita y no se pide nada.
  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  const { view: fires, refresh: refreshFires } = useFires(REFRESH_INTERVAL_MS);
  const { view: effis, refresh: refreshEffis } = useEffisStatus(REFRESH_INTERVAL_MS);

  // Viento junto a los clusters de focos. Cadencia propia: no se engancha al
  // botón "Refrescar ahora" porque Open-Meteo no actualiza su dato más rápido
  // de ~15 min.
  const impact = fires.data?.impact;
  const hotspots = fires.data?.hotspots;
  const fireWindSites = useMemo(
    () => deriveFireWindSites(impact ?? [], hotspots ?? []),
    [impact, hotspots]
  );
  // A Open-Meteo van los puntos de muestreo (centroides estables): el ancla
  // de dibujo puede moverse con cada refresco de focos sin gastar cupo.
  const fireWindPoints = useMemo(() => fireWindSites.map((s) => s.sample), [fireWindSites]);
  // El primer fetch espera a que los focos se resuelvan (dato o error): sin
  // esto cada carga haría DOS llamadas a Open-Meteo, y el cupo diario por IP
  // pondera cada ubicación de la petición como una llamada.
  const windReady = fires.data !== null || fires.status === 'error';
  const wind = useWind(showWind && windReady, fireWindPoints);

  // Campo de flujo ambiental: hook independiente de useWind (las plumas por
  // foco funcionan igual con esta capa apagada) y sin ningún fetch mientras
  // el interruptor esté apagado o el sistema pida reducir movimiento.
  const windField = useWindField(showWindField && !reducedMotion);
  // La pluma se dibuja anclada a un foco real del cluster (máx. FRP), no al
  // centroide administrativo: el vértice del cono nace de un círculo de
  // fuego visible. Si la muestra viene de una caché con clusters ya extintos,
  // se queda en su coordenada de muestreo.
  const windForMap = useMemo(() => {
    const anchors = new Map(fireWindSites.map((s) => [s.sample.join(','), s.anchor]));
    return wind.points.map((p) => {
      const anchor = anchors.get(`${p.lon},${p.lat}`);
      return anchor ? { ...p, lon: anchor[0], lat: anchor[1] } : p;
    });
  }, [wind.points, fireWindSites]);

  // El protocolo de teselas necesita saber si EFFIS está caído: con caída
  // confirmada sirve solo la copia local (Cache API) sin lanzar peticiones,
  // que serían invocaciones del Worker condenadas a fallar (y quota del free).
  const effisDown = effis.status === 'error' || effis.data?.available === false;
  useEffect(() => {
    setEffisDown(effisDown);
  }, [effisDown]);

  // EFFIS caído → recuperado: se fuerza la recarga de sus tiles. Sin esto, lo
  // que el mapa pintó durante la caída (la copia local) se quedaría congelado
  // hasta panear a zona virgen, porque MapLibre nunca reintenta tiles ya
  // resueltos.
  const [effisRefreshToken, setEffisRefreshToken] = useState(0);
  const prevEffisAvailable = useRef<boolean | null>(null);
  const effisAvailable = effis.data?.available ?? null;
  useEffect(() => {
    if (effisAvailable === null) return; // aún sin dato: no cuenta como transición
    if (prevEffisAvailable.current === false && effisAvailable) {
      setEffisRefreshToken((t) => t + 1);
    }
    prevEffisAvailable.current = effisAvailable;
  }, [effisAvailable]);

  const handleRefresh = useCallback(() => {
    refreshFires();
    refreshEffis();
  }, [refreshFires, refreshEffis]);

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
        wind={windForMap}
        showWindField={showWindField && !reducedMotion}
        windField={windField.blocks}
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
        onRefresh={handleRefresh}
      />
      <ImpactPanel
        impact={fires.data?.impact ?? []}
        onSelectMunicipality={handleSelectMunicipality}
      />
    </div>
  );
}
