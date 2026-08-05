import type maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FeedbackCard from './components/FeedbackCard';
import ImpactPanel from './components/ImpactPanel';
import LayerChips from './components/LayerChips';
import MapView from './components/MapView';
import Sidebar from './components/Sidebar';
import { REFRESH_INTERVAL_MS } from './config';
import { useFireMapData } from './hooks/useFireMapData';
import { useIncidents } from './hooks/useIncidents';
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion';
import { registerVisit, shouldShowFeedback, type FeedbackMode } from './lib/feedback';
import { matchIncidents } from './lib/incidents';
import {
  findLocalityByName,
  findLocalityBySlug,
  getLocalityParam,
  getLocalitySlug,
  setLocalityParam,
  type ActiveLocality,
  type LocalityHit,
} from './lib/locality';
import { PORTUGAL_NAME, PORTUGAL_SLUG, PT_BBOX, PT_DISTRICTS } from './lib/portugal';
import { parseLayersParam } from './lib/share';
import type { BasemapId } from './map/layers';
import type { MunicipalityImpact } from './types';

/** Preferencia de mapa base recordada entre visitas. */
const BASEMAP_KEY = 'fm-basemap';

export default function App() {
  const reducedMotion = usePrefersReducedMotion();
  // Capas que pida la URL (`?capas=`, el enlace «copiar enlace de esta vista»).
  // Presente = lista completa: lo que no aparece, apagado. Se lee una sola vez,
  // al montar: a partir de ahí manda el estado de la app.
  const fromUrl = useMemo(
    () => parseLayersParam(window.location.search, reducedMotion),
    [reducedMotion]
  );

  const [showFires, setShowFires] = useState(fromUrl?.showFires ?? true);
  const [showEffis, setShowEffis] = useState(fromUrl?.showEffis ?? true);
  const [showBoundaries, setShowBoundaries] = useState(fromUrl?.showBoundaries ?? true);
  const [showWind, setShowWind] = useState(fromUrl?.showWind ?? true);
  // Encendido por defecto (decisión de producto 2026-07-27): el coste es
  // asumible —109,2 llamadas ponderadas por refresco de 30 min sobre el cupo
  // de 10.000/día de la IP del propio visitante— y apagarlo sigue cortando
  // toda descarga. (En el widget embebible arranca apagado: ver lib/embed.ts.)
  const [showWindField, setShowWindField] = useState(fromUrl?.showWindField ?? true);
  // Riesgo de incendio (FWI): opt-in — contexto de fondo, no dato de evento.
  const [showDanger, setShowDanger] = useState(fromUrl?.showDanger ?? false);
  // El estilo del mapa base es una preferencia estable de cada usuario (quien
  // prefiere el oscuro lo prefiere siempre): se recuerda entre visitas. Solo
  // en la app — el embed lo fija quien lo inserta, con ?base=.
  const [basemap, setBasemapId] = useState<BasemapId>(() => {
    try {
      const stored = localStorage.getItem(BASEMAP_KEY);
      if (stored === 'satellite' || stored === 'dark') return stored;
    } catch {
      // localStorage inaccesible: se usa el estilo por defecto
    }
    return 'satellite';
  });
  const handleBasemapChange = useCallback((id: BasemapId) => {
    setBasemapId(id);
    try {
      localStorage.setItem(BASEMAP_KEY, id);
    } catch {
      // mejor esfuerzo: sin persistencia, el selector sigue funcionando
    }
  }, []);
  /**
   * Localidad activa (deep link resuelto o elegida en el ranking). Sube a estado
   * porque el menú «Compartir» necesita ofrecer su enlace, y hasta ahora solo
   * vivía dentro de la URL. `kind: 'country'` es la vista país de
   * /incendios/portugal: encuadra Portugal y filtra el ranking a sus distritos.
   */
  const [locality, setLocality] = useState<ActiveLocality | null>(null);

  const { fires, effis, wind, windField, rain, effisRefreshToken, refresh } = useFireMapData({
    refreshMs: REFRESH_INTERVAL_MS,
    showWind,
    showWindField,
    withRain: true,
  });

  const mapRef = useRef<maplibregl.Map | null>(null);
  const handleMapReady = useCallback((map: maplibregl.Map) => {
    mapRef.current = map;

    // Deep link por localidad: /incendios/<slug> (canónico) o ?localidad=Nombre
    // (legacy, migra al path al resolverse). Gana al hash (#map=...) si vienen
    // los dos.
    const slug = getLocalitySlug();
    const legacyName = slug ? null : getLocalityParam();
    // Vista país (/incendios/portugal): no es un municipio de muni-meta, así
    // que se resuelve antes del lookup — encuadre de Portugal continental en
    // lugar de vuelo a un punto.
    const wantsCountry =
      slug === PORTUGAL_SLUG || (legacyName ?? '').trim().toLowerCase() === PORTUGAL_SLUG;
    if (wantsCountry) {
      map.fitBounds(
        [
          [PT_BBOX[0], PT_BBOX[1]],
          [PT_BBOX[2], PT_BBOX[3]],
        ],
        { padding: 80, duration: 1600 }
      );
      setLocalityParam(PORTUGAL_NAME, PORTUGAL_SLUG);
      setLocality({ name: PORTUGAL_NAME, slug: PORTUGAL_SLUG, kind: 'country' });
    } else if (slug || legacyName) {
      const lookup = slug ? findLocalityBySlug(slug) : findLocalityByName(legacyName ?? '');
      void lookup.then((hit) => {
        if (hit) {
          map.flyTo({ center: hit.center, zoom: 12, duration: 1800 });
          setLocalityParam(hit.name, hit.slug); // fija URL canónica y título
          setLocality({ name: hit.name, slug: hit.slug, kind: 'municipality' });
        } else {
          setLocalityParam(null); // localidad desconocida: se limpia la URL
          setLocality(null);
        }
      });
    }

    // Si el usuario mueve el mapa por su cuenta, el parámetro deja de
    // describir lo que se ve: se retira (el hash sí sigue la vista).
    const clearParam = () => {
      setLocalityParam(null);
      setLocality(null);
    };
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
    // kind 'municipality' también al venir del ranking filtrado de la vista
    // país: elegir un concelho levanta el filtro.
    setLocalityParam(muni.name, muni.slug);
    setLocality({ name: muni.name, slug: muni.slug, kind: 'municipality' });
  }, []);

  // Enlaces de localidades cercanas (NearbyLocalities): mismo flujo que el
  // deep link — vuelo al centro del municipio, no al bbox de sus focos.
  const handleSelectLocality = useCallback((hit: LocalityHit) => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({ center: hit.center, zoom: 12, duration: 1400 });
    setLocalityParam(hit.name, hit.slug);
    setLocality({ name: hit.name, slug: hit.slug, kind: 'municipality' });
  }, []);

  // Enlace «Ver situación de la zona» del popup de foco: URL canónica +
  // localidad activa en la sidebar, SIN vuelo — el usuario ya está mirando
  // el foco; moverle el mapa solo desorienta.
  const handleSelectFireLocality = useCallback((name: string, slug: string) => {
    setLocalityParam(name, slug);
    setLocality({ name, slug, kind: 'municipality' });
  }, []);

  // En la vista país el ranking se ciñe a los distritos portugueses; en
  // cualquier otra, el nacional completo (ES+PT) de siempre.
  const impact = fires.data?.impact ?? [];
  const visibleImpact =
    locality?.kind === 'country' ? impact.filter((r) => PT_DISTRICTS.has(r.name)) : impact;

  // Lluvia prevista indexada por municipio, para la línea del ranking.
  const rainBySlug = useMemo(() => new Map(rain.map((p) => [p.slug, p])), [rain]);

  // Micro-encuesta: nunca al aterrizar. Se registra la visita del día y cada
  // 15 s (solo con la pestaña visible) se re-evalúa si toca mostrarla y en qué
  // modo (flujo completo, o solo el comentario para quien ya votó) — la
  // condición real (2ª visita u 90 s de sesión) vive en lib/feedback.ts.
  const [feedbackMode, setFeedbackMode] = useState<FeedbackMode | null>(null);
  useEffect(() => {
    registerVisit();
    let visibleSeconds = 0;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      visibleSeconds += 15;
      const mode = shouldShowFeedback(visibleSeconds);
      if (mode) {
        setFeedbackMode(mode);
        window.clearInterval(timer);
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  // Estado operativo oficial (Bombers/JCyL/EMS) cruzado con el ranking por
  // proximidad: "qué dicen los que están apagando el fuego".
  const incidents = useIncidents();
  const incidentsBySlug = useMemo(() => matchIncidents(impact, incidents), [impact, incidents]);

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
        rain={rain}
        incidents={incidents}
        onSelectLocality={handleSelectFireLocality}
        showDanger={showDanger}
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
          showDanger={showDanger}
          onShowDangerChange={setShowDanger}
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
        impact={visibleImpact}
        rainBySlug={rainBySlug}
        incidentsBySlug={incidentsBySlug}
        onSelectMunicipality={handleSelectMunicipality}
        onSelectLocality={handleSelectLocality}
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
        showDanger={showDanger}
        onShowDangerChange={setShowDanger}
        reducedMotion={reducedMotion}
        basemap={basemap}
        onBasemapChange={handleBasemapChange}
        onRefresh={refresh}
        locality={locality}
      />
      <ImpactPanel
        impact={visibleImpact}
        rainBySlug={rainBySlug}
        incidentsBySlug={incidentsBySlug}
        onSelectMunicipality={handleSelectMunicipality}
      />
      {feedbackMode && (
        <FeedbackCard
          mode={feedbackMode}
          localitySlug={locality?.slug}
          onClose={() => setFeedbackMode(null)}
        />
      )}
    </div>
  );
}
