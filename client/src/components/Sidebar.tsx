import { useEffect, useRef, useState } from 'react';
import logoUrl from '../assets/logo.png';
import { MANUAL_REFRESH_COOLDOWN_MS, REFRESH_INTERVAL_MS } from '../config';
import type { EffisView } from '../hooks/useEffisStatus';
import type { FiresView } from '../hooks/useFires';
import type { BasemapId } from '../map/layers';
import type { MunicipalityImpact, RegionImpact } from '../types';
import ImpactList from './ImpactList';
import Legend from './Legend';

const BASEMAP_OPTIONS: ReadonlyArray<{ value: BasemapId; label: string }> = [
  { value: 'satellite', label: 'Satélite' },
  { value: 'dark', label: 'Oscuro' },
];

interface SidebarProps {
  fires: FiresView;
  effis: EffisView;
  impact: RegionImpact[];
  onSelectMunicipality: (municipality: MunicipalityImpact) => void;
  showFires: boolean;
  onShowFiresChange: (value: boolean) => void;
  showEffis: boolean;
  onShowEffisChange: (value: boolean) => void;
  showBoundaries: boolean;
  onShowBoundariesChange: (value: boolean) => void;
  basemap: BasemapId;
  onBasemapChange: (basemap: BasemapId) => void;
  onRefresh: () => void;
}

export default function Sidebar(props: SidebarProps) {
  const { fires, effis } = props;
  const count = fires.data?.count ?? null;
  const isLoading = fires.status === 'loading';
  // Solo aplica en móvil (< md): la hoja arranca plegada para que mande el
  // mapa. En escritorio el panel es fijo y este estado se ignora vía CSS.
  const [collapsed, setCollapsed] = useState(true);
  const asideRef = useRef<HTMLElement | null>(null);

  // Con la hoja desplegada, tocar fuera de ella (el mapa) la pliega: es el
  // gesto natural de una bottom sheet. Solo en móvil; en escritorio el panel
  // es fijo y el estado collapsed ni se pinta.
  useEffect(() => {
    if (collapsed) return;
    const onPointerDown = (e: PointerEvent) => {
      if (window.matchMedia('(min-width: 768px)').matches) return; // md+: panel fijo
      if (asideRef.current && !asideRef.current.contains(e.target as Node)) {
        setCollapsed(true);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [collapsed]);

  // Arrastre vertical sobre la barra: deslizar hacia arriba despliega, hacia
  // abajo pliega. El tap sigue funcionando vía onClick; 30 px de umbral
  // separan un gesto real de un dedo que tiembla.
  const touchStartY = useRef<number | null>(null);
  const onBarTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };
  const onBarTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy < -30) {
      setCollapsed(false);
      touchStartY.current = null;
    } else if (dy > 30) {
      setCollapsed(true);
      touchStartY.current = null;
    }
  };
  const onBarTouchEnd = () => {
    touchStartY.current = null;
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

  return (
    <aside
      ref={asideRef}
      className="absolute bottom-0 left-0 z-10 flex w-full flex-col overflow-hidden
        bg-slate-950/90 text-slate-100 shadow-2xl backdrop-blur
        md:top-0 md:h-full md:w-96"
    >
      {/* Barra compacta de la hoja inferior (solo móvil): tap o arrastre */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        onTouchStart={onBarTouchStart}
        onTouchMove={onBarTouchMove}
        onTouchEnd={onBarTouchEnd}
        aria-expanded={!collapsed}
        className="relative flex touch-none items-center justify-between gap-3 px-4 pb-3 pt-4 text-left md:hidden"
      >
        {/* Asa de arrastre: la pastilla estándar de las bottom sheets */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-slate-600"
        />
        <span className="flex items-center gap-2">
          <img src={logoUrl} alt="" className="h-7 w-7" />
          <span className="text-sm font-bold leading-tight">Firemaps España</span>
        </span>
        <span className="flex items-center gap-2">
          {isLoading && (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
          )}
          <span className="rounded-full bg-orange-500/20 px-2.5 py-0.5 text-sm font-bold tabular-nums text-orange-300">
            {count ?? '—'}
          </span>
          <span className="text-xs text-slate-400">{collapsed ? '▲' : '▼'}</span>
        </span>
      </button>

      <div className={`${collapsed ? 'hidden' : 'flex'} min-h-0 flex-col md:flex md:min-h-0 md:flex-1`}>
        <header className="hidden items-center gap-3 border-b border-slate-800 px-5 py-4 md:flex">
          <img src={logoUrl} alt="Logo de Firemaps España" className="h-14 w-14 shrink-0" />
          <div>
            <h1 className="text-lg font-bold leading-tight">Firemaps España</h1>
            <p className="mt-1 text-xs text-slate-400">
              Mapa de incendios en España · satélite en tiempo casi real
            </p>
          </div>
        </header>

        <div className="max-h-[60vh] min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 md:max-h-none">
        {/* Contador + estado de la capa de focos */}
        <section>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-slate-400">Focos activos</span>
            <span className="text-3xl font-bold tabular-nums text-orange-400">
              {count ?? '—'}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Detecciones por satélite en las últimas 24 horas
          </p>

          {fires.data?.partial && (
            <p className="mt-2 rounded-md border border-amber-800 bg-amber-950/60 px-3 py-2 text-xs text-amber-200">
              Datos incompletos: alguno de los satélites no respondió en esta actualización.
            </p>
          )}

          {fires.status === 'error' && (
            <div
              role="alert"
              className="mt-2 rounded-md border border-red-800 bg-red-950/70 px-3 py-2 text-sm text-red-200"
            >
              <p className="font-semibold">Error cargando los focos de calor</p>
              <p className="mt-1 break-words text-xs leading-relaxed">{fires.error}</p>
            </div>
          )}
          {fires.status === 'ready' && count === 0 && (
            <p className="mt-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300">
              No hay focos activos ahora mismo.
            </p>
          )}
          {isLoading && (
            <p className="mt-2 flex items-center gap-2 text-xs text-slate-400">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
              Actualizando datos…
            </p>
          )}
        </section>

        {/* Ranking de localidades: en móvil vive aquí; en escritorio, en el
            panel flotante de la derecha (ImpactPanel) */}
        <section className="md:hidden">
          <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Localidades más afectadas
          </h2>
          <div className="overflow-hidden rounded-md border border-slate-800 bg-slate-900/40">
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
            <span className="mb-1 block text-sm text-slate-300">Mapa base</span>
            <div className="flex gap-1" role="radiogroup" aria-label="Estilo del mapa base">
              {BASEMAP_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  role="radio"
                  aria-checked={props.basemap === opt.value}
                  onClick={() => props.onBasemapChange(opt.value)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors
                    ${
                      props.basemap === opt.value
                        ? 'border-orange-500 bg-orange-500/20 text-orange-300'
                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <LayerToggle
            label="Focos de calor"
            checked={props.showFires}
            onChange={props.onShowFiresChange}
          />
          <LayerToggle
            label="Área quemada"
            checked={props.showEffis}
            onChange={props.onShowEffisChange}
          />
          <LayerToggle
            label="Límites administrativos"
            checked={props.showBoundaries}
            onChange={props.onShowBoundariesChange}
          />

          <button
            onClick={handleRefresh}
            disabled={isLoading || cooldownLeft > 0}
            className="w-full rounded-md bg-orange-600 px-3 py-2 text-sm font-semibold text-white
              transition-colors hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading
              ? 'Actualizando…'
              : cooldownLeft > 0
                ? `Refrescar (espera ${cooldownLeft} s)`
                : 'Refrescar ahora'}
          </button>
        </section>

        {/* Estado del servicio de perímetros */}
        <section>
          {effis.status === 'loading' && (
            <p className="text-xs text-slate-400">Comprobando el servicio de área quemada…</p>
          )}
          {(effis.status === 'error' || (effis.data && !effis.data.available)) && (
            <div
              role="status"
              className="rounded-md border border-amber-800 bg-amber-950/60 px-3 py-2 text-xs text-amber-200"
            >
              <p className="font-semibold">Servicio de área quemada inestable</p>
              <p className="mt-1 leading-relaxed">
                El servicio europeo que cartografía las zonas quemadas no responde ahora mismo. Los
                perímetros descargados en las últimas 24 horas se siguen mostrando; se reintenta
                automáticamente cada pocos minutos.
              </p>
              <details className="mt-1.5 text-amber-300/70">
                <summary className="cursor-pointer select-none">Detalles técnicos</summary>
                <p className="mt-1 break-words leading-relaxed">
                  {effis.error ?? effis.data?.note ?? 'El servicio no responde.'}
                </p>
              </details>
            </div>
          )}
          {effis.data?.available && (
            <p className="text-xs text-slate-400" title={effis.data.layerTitle ?? effis.data.layer}>
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
              Servicio de área quemada activo
              {effis.data.supportsTime
                ? ' · últimos 7 días'
                : ' · temporada actual (la capa disponible no permite acotar más)'}
            </p>
          )}
        </section>

        <section>
          <Legend showEffis={props.showEffis} />
        </section>

        </div>

        <footer className="space-y-0.5 border-t border-slate-800 px-5 py-3 text-xs text-slate-500">
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
            Datos: NASA FIRMS · Copernicus EFFIS
            <span className="mx-1">·</span>
            By{' '}
            <a
              href="https://github.com/calamarico"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
            >
              Kalamarico
            </a>
          </p>
        </footer>
      </div>
    </aside>
  );
}

function LayerToggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center justify-between text-sm ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      }`}
    >
      <span className="text-slate-300">{label}</span>
      <span className="relative inline-flex">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          className="h-5 w-9 rounded-full bg-slate-700 transition-colors peer-checked:bg-orange-600
            after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full
            after:bg-white after:transition-transform peer-checked:after:translate-x-4"
        />
      </span>
    </label>
  );
}
