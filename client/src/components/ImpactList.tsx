import { useState } from 'react';
import type { MunicipalityImpact, RegionImpact } from '../types';
import CollapsibleSection from './ui/CollapsibleSection';
import CountBadge from './ui/CountBadge';
import StatusNote from './ui/StatusNote';

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
      <StatusNote variant="empty" className="m-3">
        Ninguna localidad con focos dentro ahora mismo.
      </StatusNote>
    );
  }

  return (
    <div>
      {impact.map((region) => {
        const open = openRegions.has(region.name);
        return (
          <div key={region.name} className="border-b border-edge-subtle last:border-b-0">
            <CollapsibleSection
              open={open}
              onToggle={() => toggleRegion(region.name)}
              title={
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-ink-primary">{region.name}</span>
                  {/* Antigüedad una sola vez por comunidad: es la pasada del
                      satélite, común a todos sus municipios. */}
                  {region.lastAcqAt && (
                    <span className="shrink-0 text-micro text-ink-faint">
                      {timeAgo(region.lastAcqAt)}
                    </span>
                  )}
                </span>
              }
              trailing={
                <CountBadge
                  value={region.count}
                  size="sm"
                  label={`${region.count} ${region.count === 1 ? 'foco' : 'focos'} en ${region.name}`}
                />
              }
            >
              <ul className="pb-2">
                {region.municipalities.map((muni) => (
                  <li key={muni.name}>
                    <button
                      onClick={() => onSelectMunicipality(muni)}
                      title={`Ver ${muni.name} en el mapa`}
                      className="flex min-h-touch w-full flex-col justify-center py-1.5 pl-[34px]
                        pr-4 text-left text-xs hover:bg-surface-hover"
                    >
                      <span className="flex w-full items-baseline justify-between gap-2">
                        <span className="truncate text-ink-secondary underline-offset-2 hover:underline">
                          {muni.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-ink-muted">
                          {muni.count} {muni.count === 1 ? 'foco' : 'focos'}
                        </span>
                      </span>
                      <span className="mt-0.5 flex w-full items-baseline justify-between gap-2 text-micro text-ink-faint">
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
            </CollapsibleSection>
          </div>
        );
      })}
    </div>
  );
}
