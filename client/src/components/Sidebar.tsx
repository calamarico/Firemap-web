import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import logoUrl from '../assets/logo.png';
import { MANUAL_REFRESH_COOLDOWN_MS, REFRESH_INTERVAL_MS } from '../config';
import type { EffisView } from '../hooks/useEffisStatus';
import type { FiresView } from '../hooks/useFires';
import type { BasemapId } from '../map/layers';
import type { MunicipalityImpact, RegionImpact } from '../types';
import ImpactList from './ImpactList';
import type { LayerControls } from './LayerChips';
import Legend from './Legend';
import VideoPromo from './VideoPromo';
import Button from './ui/Button';
import CountBadge from './ui/CountBadge';
import Icon from './ui/Icon';
import LayerToggle from './ui/LayerToggle';
import Metric from './ui/Metric';
import SegmentedControl from './ui/SegmentedControl';
import StatusNote from './ui/StatusNote';

const BASEMAP_OPTIONS: ReadonlyArray<{ value: BasemapId; label: string }> = [
  { value: 'satellite', label: 'Satélite' },
  { value: 'dark', label: 'Oscuro' },
];

/** Duración del deslizamiento de la hoja; debe coincidir con --fm-duration-sheet. */
const SHEET_ANIM_MS = 300;

/**
 * Hereda de LayerControls (el contrato que consume la fila de chips de móvil):
 * así, cuando llegue una capa nueva, tsc obliga a añadirla en los dos sitios y
 * no puede quedarse solo en uno.
 */
interface SidebarProps extends LayerControls {
  fires: FiresView;
  effis: EffisView;
  impact: RegionImpact[];
  onSelectMunicipality: (municipality: MunicipalityImpact) => void;
  basemap: BasemapId;
  onBasemapChange: (basemap: BasemapId) => void;
  onRefresh: () => void;
}

export default function Sidebar(props: SidebarProps) {
  const { fires, effis } = props;
  const count = fires.data?.count ?? null;
  const isLoading = fires.status === 'loading';
  // Hoja inferior; solo aplica en móvil (< md): arranca plegada para que mande
  // el mapa. En escritorio el panel es fijo y md:translate-y-0 neutraliza todo
  // el desplazamiento, así que nada de esto afecta a ese layout.
  const [collapsed, setCollapsed] = useState(true);
  // Colapso de escritorio (≥ md), independiente de la hoja móvil: el panel se
  // desliza fuera por la izquierda y queda una pestaña en el borde para
  // reabrirlo. La preferencia sobrevive entre visitas.
  const DESKTOP_COLLAPSED_KEY = 'fm-sidebar-collapsed';
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    try {
      return localStorage.getItem(DESKTOP_COLLAPSED_KEY) === '1';
    } catch {
      return false; // localStorage inaccesible: siempre desplegada
    }
  });
  const toggleDesktopCollapsed = () => {
    setDesktopCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(DESKTOP_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // Cuota llena o modo privado: sin persistencia, pero el toggle funciona.
      }
      return next;
    });
  };
  const asideRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [isMobile, setIsMobile] = useState(() => !window.matchMedia('(min-width: 768px)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(!e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Altura de la parte plegable = cuánto hay que bajar la hoja para dejar solo
  // la barra a la vista. Se mide en vez de fijarla a ojo, y se re-mide cuando
  // el contenido cambia de alto (avisos, ranking, spinner de carga...).
  // useLayoutEffect: la medida entra antes del primer pintado, si no la hoja
  // asomaría desplegada un frame al cargar.
  const [contentHeight, setContentHeight] = useState(0);
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setContentHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // La transición se activa solo durante un plegado/desplegado real: si
  // estuviera siempre puesta, cualquier cambio de altura del contenido (el
  // "Actualizando datos…" que aparece cada 5 min) haría bailar la hoja.
  const [animating, setAnimating] = useState(false);
  const animTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(animTimer.current), []);

  const setCollapsedAnimated = (next: boolean) => {
    setAnimating(true);
    setCollapsed(next);
    window.clearTimeout(animTimer.current);
    animTimer.current = window.setTimeout(() => setAnimating(false), SHEET_ANIM_MS + 20);
  };

  // Con la hoja desplegada, tocar fuera de ella (el mapa) la pliega: es el
  // gesto natural de una bottom sheet.
  useEffect(() => {
    if (collapsed || !isMobile) return;
    const onPointerDown = (e: PointerEvent) => {
      if (asideRef.current && !asideRef.current.contains(e.target as Node)) {
        setCollapsedAnimated(true);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [collapsed, isMobile]);

  // Arrastre vertical de la barra: la hoja sigue al dedo (sin transición, para
  // que no vaya a remolque) y al soltar cae al estado más cercano.
  const [dragY, setDragY] = useState<number | null>(null);
  const drag = useRef<{ startY: number; base: number; y: number; moved: boolean } | null>(null);

  const onBarTouchStart = (e: React.TouchEvent) => {
    const base = collapsed ? contentHeight : 0;
    drag.current = { startY: e.touches[0].clientY, base, y: base, moved: false };
    setAnimating(false);
  };
  const onBarTouchMove = (e: React.TouchEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.touches[0].clientY - d.startY;
    if (Math.abs(dy) > 4) d.moved = true;
    d.y = Math.min(contentHeight, Math.max(0, d.base + dy));
    setDragY(d.y);
  };
  const onBarTouchEnd = () => {
    const d = drag.current;
    drag.current = null;
    setDragY(null);
    // Sin recorrido real fue un tap: lo resuelve onClick, que sí alterna.
    if (!d || !d.moved) return;
    // Umbral generoso: un arrastre corto pero claro ya cambia de estado, sin
    // obligar a recorrer media pantalla.
    const threshold = Math.min(80, contentHeight * 0.3);
    setCollapsedAnimated(d.base === 0 ? d.y > threshold : d.y > contentHeight - threshold);
  };
  const handleBarClick = () => {
    // Un arrastre acaba disparando click: si hubo gesto, ya se decidió estado.
    if (drag.current?.moved) return;
    setCollapsedAnimated(!collapsed);
  };

  // Segundos restantes hasta poder refrescar a mano otra vez: cada pulsación
  // gasta invocaciones del plan free de Cloudflare, así que no se permite
  // encadenarlas.
  const [cooldownLeft, setCooldownLeft] = useState(0);
  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const id = window.setTimeout(() => setCooldownLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldownLeft]);

  const handleRefresh = () => {
    if (isLoading || cooldownLeft > 0) return;
    setCooldownLeft(Math.round(MANUAL_REFRESH_COOLDOWN_MS / 1000));
    props.onRefresh();
  };

  // Con el panel plegado (hoja móvil abajo o panel de escritorio fuera de
  // pantalla) su contenido seguiría siendo enfocable: inert lo saca del
  // tabulado y de los lectores de pantalla.
  const hidden = isMobile ? collapsed && dragY === null : desktopCollapsed;
  const inertProps = (hidden ? { inert: '' } : {}) as React.HTMLAttributes<HTMLDivElement>;

  const sheetY = dragY ?? (collapsed ? contentHeight : 0);

  return (
    <aside
      ref={asideRef}
      style={{ '--sheet-y': `${sheetY}px` } as React.CSSProperties}
      className={`absolute bottom-0 left-0 z-panel flex w-full translate-y-[var(--sheet-y)] flex-col
        rounded-t-xl bg-surface-panel text-ink-primary shadow-panel backdrop-blur
        md:top-0 md:h-full md:w-96 md:translate-y-0 md:rounded-none
        md:transition-transform md:duration-[var(--fm-duration-sheet)] md:ease-sheet
        motion-reduce:md:transition-none
        ${desktopCollapsed ? 'md:-translate-x-full' : 'md:translate-x-0'}
        ${animating ? 'transition-transform duration-[var(--fm-duration-sheet)] ease-sheet motion-reduce:transition-none' : ''}`}
    >
      {/* Pestaña de escritorio: sobresale del borde derecho del panel, así que
          con el panel fuera de pantalla (-translate-x-full) queda pegada al
          borde izquierdo de la ventana. El overflow del aside debe permitirla:
          por eso el recorte (overflow-hidden original) baja al contenido. */}
      <button
        onClick={toggleDesktopCollapsed}
        aria-expanded={!desktopCollapsed}
        aria-label={desktopCollapsed ? 'Mostrar panel' : 'Ocultar panel'}
        title={desktopCollapsed ? 'Mostrar panel' : 'Ocultar panel'}
        className="absolute left-full top-4 z-panel hidden h-12 w-6 items-center justify-center
          rounded-r-lg bg-surface-panel text-ink-muted shadow-panel backdrop-blur
          hover:text-ink-primary md:flex"
      >
        <Icon
          name="chevron-up"
          size={16}
          className={`transition-transform duration-[var(--fm-duration-base)] ease-sheet
            motion-reduce:transition-none ${desktopCollapsed ? 'rotate-90' : '-rotate-90'}`}
        />
      </button>

      {/* Barra compacta de la hoja inferior (solo móvil): tap o arrastre */}
      <button
        onClick={handleBarClick}
        onTouchStart={onBarTouchStart}
        onTouchMove={onBarTouchMove}
        onTouchEnd={onBarTouchEnd}
        onTouchCancel={onBarTouchEnd}
        aria-expanded={!collapsed}
        className="relative flex min-h-touch touch-none items-center justify-between gap-3 px-4 pb-3 pt-4 text-left md:hidden"
      >
        {/* Asa de arrastre: la pastilla estándar de las bottom sheets */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-[color:var(--fm-slate-600)]"
        />
        <span className="flex items-center gap-2">
          <img src={logoUrl} alt="" className="h-7 w-7" />
          <span className="font-display text-sm font-bold leading-tight">Firemaps España</span>
        </span>
        <span className="flex items-center gap-2">
          {isLoading && (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent text-ink-muted" />
          )}
          <CountBadge value={count} label="Focos activos" />
          <Icon
            name="chevron-up"
            size={16}
            className={`text-ink-muted transition-transform duration-[var(--fm-duration-base)]
              ease-sheet motion-reduce:transition-none ${collapsed ? '' : 'rotate-180'}`}
          />
        </span>
      </button>

      {/* Siempre montado: el plegado es un desplazamiento, no un display:none
          (si no, no habría nada que animar). */}
      <div
        ref={contentRef}
        {...inertProps}
        className="flex min-h-0 flex-col overflow-hidden md:min-h-0 md:flex-1"
      >
        <header className="hidden items-center gap-3 border-b border-edge px-5 py-4 md:flex">
          <img src={logoUrl} alt="Logo de Firemaps España" className="h-14 w-14 shrink-0" />
          {/* Un solo h1 con marca + descriptor: el descriptor lleva la keyword
              y así el encabezado principal de la página no es solo la marca. */}
          <h1>
            <span className="block text-lg font-bold leading-tight">Firemaps España</span>
            <span className="mt-1 block text-xs font-normal text-ink-muted">
              Mapa de incendios en España y Portugal · satélite en tiempo casi real
            </span>
          </h1>
        </header>

        <div className="max-h-[60vh] min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 md:max-h-none">
        {/* Contador + estado de la capa de focos */}
        <section>
          <Metric
            label="Focos activos"
            hint="Detecciones por satélite en las últimas 24 horas"
            value={count}
            size="lg"
            tone="brand"
          />

          {fires.data?.partial && (
            <StatusNote variant="warning" className="mt-2">
              Datos incompletos: alguno de los satélites no respondió en esta actualización.
            </StatusNote>
          )}

          {fires.status === 'error' && (
            <StatusNote variant="error" title="Error cargando los focos de calor" className="mt-2">
              {fires.error}
            </StatusNote>
          )}
          {fires.status === 'ready' && count === 0 && (
            <StatusNote variant="empty" className="mt-2">
              No hay focos activos ahora mismo.
            </StatusNote>
          )}
          {isLoading && (
            <StatusNote variant="loading" className="mt-2">
              Actualizando datos…
            </StatusNote>
          )}
        </section>

        {/* Ranking de localidades: en móvil vive aquí; en escritorio, en el
            panel flotante de la derecha (ImpactPanel) */}
        <section className="md:hidden">
          <h2 className="fm-eyebrow mb-1.5">Localidades más afectadas</h2>
          <div className="overflow-hidden rounded-md border border-edge bg-surface-sunken">
            <ImpactList
              impact={props.impact}
              onSelectMunicipality={(muni) => {
                // Pliega la hoja para que el vuelo del mapa se vea.
                setCollapsed(true);
                props.onSelectMunicipality(muni);
              }}
            />
          </div>
        </section>

        {/* Controles */}
        <section className="space-y-3">
          <div>
            <span className="mb-1 block text-sm text-ink-secondary">Mapa base</span>
            <SegmentedControl
              options={BASEMAP_OPTIONS}
              value={props.basemap}
              onChange={props.onBasemapChange}
              ariaLabel="Estilo del mapa base"
            />
          </div>

          {/* Los interruptores viven aquí solo en escritorio: en móvil los
              sustituye la fila de chips que flota sobre el mapa (LayerChips),
              visible sin desplegar la hoja. Se ocultan con display:none y no
              desmontando, así el markup sigue en el DOM para el rastreador y
              nunca hay dos controles del mismo estado expuestos a la vez. */}
          <div className="hidden space-y-3 md:block">
            <LayerToggle
              label="Focos de calor"
              checked={props.showFires}
              onChange={props.onShowFiresChange}
              swatch="var(--fm-severity-3)"
            />
            <LayerToggle
              label="Área quemada"
              checked={props.showEffis}
              onChange={props.onShowEffisChange}
              swatch="var(--fm-burnt-fill)"
            />
            <LayerToggle
              label="Viento"
              checked={props.showWind}
              onChange={props.onShowWindChange}
              swatch="var(--fm-map-smoke-band-1)"
              description="Dirección y velocidad · Open-Meteo"
            />
            <LayerToggle
              label="Flujo de viento"
              checked={props.showWindField && !props.reducedMotion}
              onChange={props.onShowWindFieldChange}
              swatch="var(--fm-map-flow-trail)"
              disabled={props.reducedMotion}
              description={
                props.reducedMotion
                  ? 'Requiere animación; tu sistema tiene activado «reducir movimiento».'
                  : 'Viento general de la jornada · Open-Meteo'
              }
            />
            <LayerToggle
              label="Límites administrativos"
              checked={props.showBoundaries}
              onChange={props.onShowBoundariesChange}
            />
          </div>
          <p className="text-micro text-ink-faint md:hidden">
            Las capas se activan desde los botones sobre el mapa.
          </p>

          <Button
            size="lg"
            className="w-full"
            onClick={handleRefresh}
            disabled={isLoading || cooldownLeft > 0}
            loading={isLoading}
          >
            {isLoading
              ? 'Actualizando…'
              : cooldownLeft > 0
                ? `Refrescar (espera ${cooldownLeft} s)`
                : 'Refrescar ahora'}
          </Button>
        </section>

        {/* Estado del servicio de perímetros */}
        <section>
          {effis.status === 'loading' && (
            <StatusNote variant="loading">Comprobando el servicio de área quemada…</StatusNote>
          )}
          {(effis.status === 'error' || (effis.data && !effis.data.available)) && (
            <StatusNote
              variant="warning"
              title="Servicio de área quemada inestable"
              details={effis.error ?? effis.data?.note ?? 'El servicio no responde.'}
            >
              El servicio europeo que cartografía las zonas quemadas no responde ahora mismo. Se
              muestran los perímetros que este navegador descargó en las últimas 24 horas; se
              reintenta automáticamente cada pocos minutos.
            </StatusNote>
          )}
          {effis.data?.available && (
            <StatusNote variant="ok" tooltip={effis.data.layerTitle ?? effis.data.layer}>
              Servicio de área quemada activo
              {effis.data.supportsTime
                ? ' · últimos 7 días'
                : ' · temporada actual (la capa disponible no permite acotar más)'}
            </StatusNote>
          )}
        </section>

        <section>
          <Legend
            showEffis={props.showEffis}
            showWind={props.showWind}
            showWindField={props.showWindField && !props.reducedMotion}
          />
        </section>

        {/* Prosa indexable: describe las features en texto real (Google
            renderiza la SPA y sin esto solo vería etiquetas de UI). Los
            <details> van cerrados: el contenido se indexa igual y el panel
            no se alarga. */}
        <section className="space-y-2 text-sm text-ink-secondary">
          <h2 className="fm-eyebrow mb-1.5">Sobre este mapa</h2>

          {/* Vídeos de presentación: dos miniaturas en una fila, que el bloque
              de prosa ya es largo y esto no debe alargarlo más. */}
          <VideoPromo />

          <details>
            <summary className="cursor-pointer select-none text-ink-primary">
              Qué muestra este mapa de incendios
            </summary>
            <div className="mt-2 space-y-2">
              <p>
                <strong className="font-semibold text-ink-primary">
                  Focos de calor por satélite:
                </strong>{' '}
                detecciones de los satélites de la NASA (VIIRS y MODIS, programa FIRMS) en las
                últimas 24 horas, coloreadas por potencia radiativa: de amarillo (baja) a rojo
                (extrema). Se actualizan cada 5 minutos.
              </p>
              <p>
                <strong className="font-semibold text-ink-primary">Área quemada:</strong>{' '}
                perímetros de zonas quemadas de los últimos 7 días, del programa europeo
                Copernicus (EFFIS).
              </p>
              <p>
                <strong className="font-semibold text-ink-primary">
                  Viento junto a los incendios:
                </strong>{' '}
                cada foco activo dibuja la pluma de humo hacia donde lo empuja el viento. Cuanto
                más largo y estrecho el cono, más fuerte sopla; cuanto más corto y abierto, más
                se queda el humo en la zona. Cada banda son 15 minutos de recorrido, hasta tres
                cuartos de hora.
              </p>
              <p>
                <strong className="font-semibold text-ink-primary">Flujo de viento:</strong>{' '}
                dibuja hacia dónde se mueve el aire sobre todo el territorio. Es el viento
                general de la jornada, útil para entender de dónde viene el tiempo; para saber a
                dónde va el humo de un incendio concreto, mira su pluma. Solo descarga datos
                mientras la capa está activa.
              </p>
              <p>
                <strong className="font-semibold text-ink-primary">Localidades afectadas:</strong>{' '}
                ranking de municipios con focos activos; al tocar uno el mapa vuela a su zona.
              </p>
            </div>
          </details>

          <details>
            <summary className="cursor-pointer select-none text-ink-primary">
              ¿Por qué huele a humo si el incendio está lejos?
            </summary>
            <p className="mt-2">
              El humo viaja con el viento y puede recorrer decenas de kilómetros: es habitual
              olerlo en ciudades alejadas del fuego. La pluma azulada de cada incendio muestra
              hacia dónde va el humo y su alcance aproximado: si tu localidad está a sotavento
              de un foco, ahí tienes la explicación.
            </p>
          </details>

          <details>
            <summary className="cursor-pointer select-none text-ink-primary">
              Fuentes y actualización de los datos
            </summary>
            <p className="mt-2">
              Focos de calor de NASA FIRMS, área quemada de Copernicus EFFIS y viento de
              Open-Meteo, sobre imagen satelital de Esri. Todo se actualiza automáticamente cada
              pocos minutos. Gratuito, sin registro y pensado también para el móvil. Puedes
              compartir el mapa centrado en tu municipio con el enlace{' '}
              <code className="text-xs">?localidad=Nombre</code>.
            </p>
          </details>
        </section>

        </div>

        <footer className="space-y-0.5 border-t border-edge px-5 py-3 text-xs text-ink-faint">
          <p>
            {fires.lastUpdated
              ? `Última actualización: ${fires.lastUpdated.toLocaleTimeString('es-ES')}`
              : 'Sin datos todavía'}
            {fires.data?.cached ? ' (cache del proxy)' : ''}
            <span className="mx-1">·</span>
            Auto-refresco cada {Math.round(REFRESH_INTERVAL_MS / 60_000)} min
          </p>
          {/* Única mención a las fuentes: la piden las condiciones de uso de los datos. */}
          <p>
            Datos: NASA FIRMS · Copernicus EFFIS ·{' '}
            <a
              href="https://open-meteo.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-muted underline-offset-2 hover:text-ink-primary hover:underline"
            >
              Open-Meteo
            </a>
            <span className="mx-1">·</span>
            By{' '}
            <a
              href="https://github.com/calamarico"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-muted underline-offset-2 hover:text-ink-primary hover:underline"
            >
              Kalamarico
            </a>
          </p>
        </footer>
      </div>
    </aside>
  );
}
