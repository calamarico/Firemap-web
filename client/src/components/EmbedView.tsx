import type maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import logoUrl from '../assets/logo.png';
import { EMBED_REFRESH_INTERVAL_MS } from '../config';
import { useFireMapData } from '../hooks/useFireMapData';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { fullMapUrl, type EmbedConfig } from '../lib/embed';
import { findLocalityByName, findLocalityBySlug } from '../lib/locality';
import { PORTUGAL_NAME, PORTUGAL_SLUG, PT_BBOX, PT_DISTRICTS } from '../lib/portugal';
import { paletteThemeFor } from '../map/layers';
import { SEVERITY } from '../styles/mapTokens';
import type { MunicipalityImpact } from '../types';
import ImpactPanel from './ImpactPanel';
import LayerChips from './LayerChips';
import MapView from './MapView';
import Icon from './ui/Icon';
import { SeverityDot } from './ui/Severity';

/**
 * Widget embebible: el mapa desnudo para vivir dentro de un <iframe> ajeno.
 * Quita todo lo que solo tiene sentido en la web propia (sidebar, prosa SEO,
 * vídeos, botón de refresco manual) y añade lo que solo tiene sentido fuera:
 *
 * - Marca clicable → el enlace de vuelta al mapa completo, que es lo único que
 *   este widget "cobra" por existir (crédito + tráfico de retorno).
 * - Gestos cooperativos: el zoom con rueda pide Ctrl/⌘ para no secuestrar el
 *   scroll del artículo que lo embebe.
 * - Fuentes de los datos visibles sin desplegar nada (lo piden las condiciones
 *   de uso de NASA FIRMS y Copernicus, y en un iframe pequeño el "i" de la
 *   atribución de MapLibre pasa desapercibido).
 *
 * El contrato de la URL vive en lib/embed.ts; la fontanería de datos, en
 * useFireMapData (compartida con la app completa).
 */
export default function EmbedView({ config }: { config: EmbedConfig }) {
  const [showFires, setShowFires] = useState(config.showFires);
  const [showEffis, setShowEffis] = useState(config.showEffis);
  const [showBoundaries, setShowBoundaries] = useState(config.showBoundaries);
  const [showWind, setShowWind] = useState(config.showWind);
  const [showWindField, setShowWindField] = useState(config.showWindField);
  const [showDanger, setShowDanger] = useState(config.showDanger);

  const reducedMotion = usePrefersReducedMotion();
  const { fires, wind, windField, effisRefreshToken } = useFireMapData({
    refreshMs: EMBED_REFRESH_INTERVAL_MS,
    showWind,
    showWindField,
  });

  const mapRef = useRef<maplibregl.Map | null>(null);
  // Localidad ya resuelta: la necesita el enlace de salida para apuntar a
  // /incendios/<slug> en vez de a la home.
  const [slug, setSlug] = useState<string | null>(null);
  const [localityName, setLocalityName] = useState<string | null>(null);
  // Vista actual, para que el enlace de salida abra el mapa completo donde el
  // lector dejó el iframe. Se refresca en moveend (no en cada frame).
  const [view, setView] = useState<{ center: [number, number]; zoom: number } | null>(null);
  // Encuadre pendiente: resolver la localidad implica descargar el meta de
  // municipios, y esa carrera la puede ganar cualquiera de los dos —el mapa o
  // el fetch—. Quien llegue primero deja el encuadre aquí y el otro lo aplica.
  const pendingJump = useRef<((map: maplibregl.Map) => void) | null>(null);

  const handleMapReady = useCallback((map: maplibregl.Map) => {
    mapRef.current = map;

    const syncView = () => {
      const center = map.getCenter();
      setView({ center: [center.lng, center.lat], zoom: map.getZoom() });
    };
    syncView();
    map.on('moveend', syncView);

    pendingJump.current?.(map);
    pendingJump.current = null;
  }, []);

  // `?localidad=` admite slug (/incendios/<slug>) o nombre: el generador de
  // código emite el slug, pero un enlace escrito a mano suele traer el nombre.
  const localityParam = config.locality;
  useEffect(() => {
    if (!localityParam) return;
    let cancelled = false;
    const key = localityParam.trim().toLowerCase();
    void (async () => {
      // Vista país (?localidad=portugal): no es un municipio de muni-meta —
      // encuadre del país entero en vez de salto a un punto.
      if (key === PORTUGAL_SLUG) {
        setSlug(PORTUGAL_SLUG); // el enlace de salida apunta a /incendios/portugal
        setLocalityName(PORTUGAL_NAME);
        if (config.center) return;
        const jump = (map: maplibregl.Map) => {
          if (config.zoom != null) {
            map.jumpTo({
              center: [(PT_BBOX[0] + PT_BBOX[2]) / 2, (PT_BBOX[1] + PT_BBOX[3]) / 2],
              zoom: config.zoom,
            });
          } else {
            map.fitBounds(
              [
                [PT_BBOX[0], PT_BBOX[1]],
                [PT_BBOX[2], PT_BBOX[3]],
              ],
              { padding: 40, duration: 0 }
            );
          }
        };
        if (mapRef.current) jump(mapRef.current);
        else pendingJump.current = jump;
        return;
      }
      const hit = (await findLocalityBySlug(key)) ?? (await findLocalityByName(localityParam));
      if (cancelled || !hit) return;
      setSlug(hit.slug);
      setLocalityName(hit.name);
      // Sin `centro` explícito el encuadre lo pone la localidad; con los dos,
      // manda lo que pidió quien insertó el mapa.
      if (config.center) return;
      const jump = (map: maplibregl.Map) =>
        map.jumpTo({ center: hit.center, zoom: config.zoom ?? 11 });
      if (mapRef.current) jump(mapRef.current);
      else pendingJump.current = jump;
    })();
    return () => {
      cancelled = true;
    };
  }, [localityParam, config.center, config.zoom]);

  const handleSelectMunicipality = useCallback((muni: MunicipalityImpact) => {
    if (!mapRef.current || !muni.bbox) return;
    const [minLon, minLat, maxLon, maxLat] = muni.bbox;
    mapRef.current.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      { padding: 60, maxZoom: 12.5, duration: 1400 }
    );
  }, []);

  const count = fires.data?.count ?? null;
  const outUrl = fullMapUrl(slug, view);
  const title = localityName
    ? `Incendios en ${localityName} · mapa en tiempo real`
    : 'Mapa de incendios en España y Portugal';

  return (
    <div className="relative h-full w-full overflow-hidden bg-app">
      <MapView
        hotspots={fires.data?.hotspots ?? []}
        showFires={showFires}
        showEffis={showEffis}
        effisRefreshToken={effisRefreshToken}
        showBoundaries={showBoundaries}
        showWind={showWind}
        wind={wind}
        showWindField={showWindField && !reducedMotion}
        windField={windField}
        showDanger={showDanger}
        basemap={config.basemap}
        onMapReady={handleMapReady}
        initialCenter={config.center}
        initialZoom={config.zoom}
        // La paleta la manda el MAPA BASE, no el tema de la interfaz: son ejes
        // independientes (paneles oscuros sobre Positron es el caso que propone
        // /insertar) y lo que tiene que contrastar es con lo de debajo.
        mapTheme={paletteThemeFor(config.basemap)}
        cooperativeGestures
        fullscreen
        syncHash={false}
        ariaLabel={title}
      />

      {/* Banda superior en columna: fila de marca + salida al mapa completo y,
          debajo, los chips de capa. La columna es lo que evita el solape en un
          iframe estrecho: cuando el botón de salida no cabe junto a la marca y
          cae a otra línea, los chips bajan con él en vez de taparlo. */}
      <div className="pointer-events-none absolute inset-x-2 top-2 z-panel flex flex-col gap-2">
        <div className="flex flex-wrap items-start gap-2">
          <a
            href={outUrl}
            target="_blank"
            rel="noopener"
            className="pointer-events-auto flex items-center gap-2 rounded-lg bg-surface-panel px-2.5
              py-1.5 text-ink-primary shadow-panel backdrop-blur hover:bg-surface-hover"
          >
            <img src={logoUrl} alt="" className="h-7 w-7 shrink-0" />
            <span className="leading-tight">
              <span className="block font-display text-xs font-bold">Radar de Incendios</span>
              <span className="block text-micro text-ink-muted">
                {count === null ? (
                  'Cargando focos…'
                ) : (
                  <>
                    <span className="fm-tabular font-semibold text-ember-text">{count}</span> focos
                    activos
                    {fires.lastUpdated &&
                      ` · ${fires.lastUpdated.toLocaleTimeString('es-ES', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`}
                  </>
                )}
              </span>
            </span>
          </a>

          <a
            href={outUrl}
            target="_blank"
            rel="noopener"
            // Pegado a la marca, no al extremo derecho: la esquina superior
            // derecha es de ImpactPanel cuando el embed lleva ?ranking=1.
            className="pointer-events-auto inline-flex min-h-[36px] items-center gap-1.5
              rounded-full bg-action px-3 text-xs font-semibold text-[color:var(--fm-text-on-accent)]
              shadow-control hover:bg-action-hover"
          >
            Ver el mapa completo
            <Icon name="external-link" size={13} />
          </a>
        </div>

        {/* Controles de capa: los mismos chips que en el móvil de la app. */}
        {config.controls && (
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
        )}
      </div>

      {config.ranking && (
        <ImpactPanel
          // Embed centrado en Portugal: el ranking se ciñe a sus distritos,
          // coherente con lo que el medio que lo inserta está mostrando.
          impact={
            slug === PORTUGAL_SLUG
              ? (fires.data?.impact ?? []).filter((r) => PT_DISTRICTS.has(r.name))
              : (fires.data?.impact ?? [])
          }
          onSelectMunicipality={handleSelectMunicipality}
        />
      )}

      {/* Leyenda + fuentes, abajo a la izquierda (la derecha la ocupan el zoom,
          la escala y la atribución de MapLibre). Bajo 420 px de iframe se
          oculta: ahí se comería medio mapa, y las fuentes siguen en el "i" de la
          atribución. El umbral lo mide el iframe, no la ventana del lector. */}
      {config.legend && (
        <div
          className="pointer-events-none absolute bottom-2 left-2 z-panel hidden max-w-[19rem]
            rounded-lg bg-surface-panel px-2.5 py-2 shadow-panel backdrop-blur min-[420px]:block"
        >
          <span className="fm-eyebrow mb-1 block">Potencia del foco</span>
          <ul className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {SEVERITY.map((step) => (
              <li key={step.level} className="flex items-center gap-1 text-micro text-ink-secondary">
                <SeverityDot level={step.level} size={10} />
                {step.label}
              </li>
            ))}
          </ul>
          {showEffis && (
            <div className="mt-1 flex items-center gap-1 text-micro text-ink-secondary">
              <SeverityDot
                color="var(--fm-burnt-fill)"
                shape="square"
                size={10}
                className="opacity-75"
              />
              Área quemada estimada
            </div>
          )}
          {/* Crédito de los datos siempre visible: lo piden las condiciones de
              uso de FIRMS y Copernicus, y aquí no hay footer donde esconderlo. */}
          <p className="mt-1.5 text-micro leading-snug text-ink-faint">
            Focos: NASA FIRMS · Área quemada: Copernicus EFFIS · Viento: Open-Meteo
          </p>
        </div>
      )}

      {fires.status === 'error' && (
        <div
          role="status"
          className="absolute inset-x-2 bottom-2 z-panel mx-auto max-w-sm rounded-lg bg-surface-panel
            px-3 py-2 text-center text-micro text-ink-secondary shadow-panel backdrop-blur"
        >
          No se han podido cargar los focos.{' '}
          <a href={outUrl} target="_blank" rel="noopener" className="text-[color:var(--fm-text-link)] underline">
            Abrir el mapa completo
          </a>
        </div>
      )}
    </div>
  );
}
