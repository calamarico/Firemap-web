import type { EffisView } from '../hooks/useEffisStatus';
import type { FiresView } from '../hooks/useFires';
import type { BasemapId } from '../map/layers';
import Legend from './Legend';

const BASEMAP_OPTIONS: ReadonlyArray<{ value: BasemapId; label: string }> = [
  { value: 'satellite', label: 'Satélite' },
  { value: 'dark', label: 'Oscuro' },
];

interface SidebarProps {
  fires: FiresView;
  effis: EffisView;
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

  return (
    <aside
      className="absolute bottom-0 left-0 z-10 flex max-h-[55vh] w-full flex-col overflow-y-auto
        bg-slate-950/90 text-slate-100 shadow-2xl backdrop-blur
        md:top-0 md:h-full md:max-h-full md:w-96"
    >
      <header className="border-b border-slate-800 px-5 py-4">
        <h1 className="text-lg font-bold leading-tight">Focos de calor · España</h1>
        <p className="mt-1 text-xs text-slate-400">
          Detección por satélite en tiempo casi real
        </p>
      </header>

      <div className="flex-1 space-y-5 px-5 py-4">
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
            onClick={props.onRefresh}
            disabled={isLoading}
            className="w-full rounded-md bg-orange-600 px-3 py-2 text-sm font-semibold text-white
              transition-colors hover:bg-orange-500 disabled:cursor-wait disabled:opacity-60"
          >
            {isLoading ? 'Actualizando…' : 'Refrescar ahora'}
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
                automáticamente cada minuto.
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

        {/* Nota metodológica: evita confundir detecciones con incendios confirmados */}
        <section className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs leading-relaxed text-slate-400">
          <strong className="text-slate-300">Nota:</strong> los focos son{' '}
          <em>anomalías térmicas detectadas por satélite</em> (posibles incendios, pero también
          quemas agrícolas, industria, etc.), no incendios oficialmente confirmados. Los perímetros
          de área quemada son <em>estimaciones cartografiadas a posteriori</em> y pueden ir con
          retraso respecto al tiempo real.
        </section>
      </div>

      <footer className="space-y-0.5 border-t border-slate-800 px-5 py-3 text-xs text-slate-500">
        <p>
          {fires.lastUpdated
            ? `Última actualización: ${fires.lastUpdated.toLocaleTimeString('es-ES')}`
            : 'Sin datos todavía'}
          {fires.data?.cached ? ' (cache del proxy)' : ''}
          <span className="mx-1">·</span>
          Auto-refresco cada 2 min
        </p>
        {/* Única mención a las fuentes: la piden las condiciones de uso de los datos. */}
        <p>Datos: NASA FIRMS · Copernicus EFFIS</p>
      </footer>
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
