import { useState } from 'react';
import type { MunicipalityImpact, RegionImpact } from '../types';

interface ImpactListProps {
  impact: RegionImpact[];
  /** Al pulsar una localidad, el mapa vuela a sus focos. */
  onSelectMunicipality: (municipality: MunicipalityImpact) => void;
}

/** "hace 5 min", "hace 3 h", "hace 2 días": edad de la última detección. */
function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

/**
 * Hora local de la detección: "15:55" (o "23/07 15:55" si no es de hoy). Se
 * muestra la hora absoluta y no la edad relativa porque los satélites barren
 * la zona de una pasada: casi todos los municipios de una comunidad comparten
 * el minuto exacto, y repetir "hace 7 h" en cada fila solo parecía un dato
 * viejo. La antigüedad se indica una vez, en la cabecera de la comunidad.
 */
function formatAcq(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const isToday = date.toDateString() === new Date().toDateString();
  if (isToday) return time;
  const day = date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
  return `${day} ${time}`;
}

/**
 * Acordeón de localidades afectadas agrupadas por comunidad autónoma. Dentro
 * de cada comunidad, la localidad con la detección más reciente va primero:
 * así se ve a qué municipios está llegando el fuego ahora.
 * Se usa en dos contenedores: el panel flotante de escritorio (ImpactPanel)
 * y una sección de la hoja inferior en móvil (Sidebar).
 */
export default function ImpactList({ impact, onSelectMunicipality }: ImpactListProps) {
  const [openRegions, setOpenRegions] = useState<ReadonlySet<string>>(new Set());

  const toggleRegion = (name: string) => {
    setOpenRegions((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (impact.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-slate-400">
        Ninguna localidad con focos dentro ahora mismo.
      </p>
    );
  }

  return (
    <div>
      {impact.map((region) => {
        const open = openRegions.has(region.name);
        return (
          <div key={region.name} className="border-b border-slate-800/60 last:border-b-0">
            <button
              onClick={() => toggleRegion(region.name)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left
                text-sm hover:bg-slate-900/60"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="w-3 shrink-0 text-xs text-slate-500">{open ? '▾' : '▸'}</span>
                <span className="truncate text-slate-200">{region.name}</span>
                {/* Antigüedad una sola vez por comunidad: es la pasada del
                    satélite, común a todos sus municipios. */}
                {region.lastAcqAt && (
                  <span className="shrink-0 text-[11px] text-slate-500">
                    {timeAgo(region.lastAcqAt)}
                  </span>
                )}
              </span>
              <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-xs font-semibold tabular-nums text-orange-300">
                {region.count}
              </span>
            </button>
            {open && (
              <ul className="pb-2">
                {region.municipalities.map((muni) => (
                  <li key={muni.name}>
                    <button
                      onClick={() => onSelectMunicipality(muni)}
                      title={`Ver ${muni.name} en el mapa`}
                      className="w-full py-1.5 pl-9 pr-4 text-left text-xs hover:bg-slate-900/60"
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-slate-300 underline-offset-2 hover:underline">
                          {muni.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-400">
                          {muni.count} {muni.count === 1 ? 'foco' : 'focos'}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-baseline justify-between gap-2 text-[11px] text-slate-500">
                        <span className="tabular-nums">
                          {muni.lastAcqAt ? `última detección a las ${formatAcq(muni.lastAcqAt)}` : ''}
                        </span>
                        {muni.maxFrp !== null && (
                          <span className="shrink-0 tabular-nums">máx {muni.maxFrp.toFixed(0)} MW</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
