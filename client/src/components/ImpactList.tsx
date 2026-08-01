import { useState } from 'react';
import { RAIN_BADGE_MIN_PROB } from '../config';
import { formatRainDay, timeAgo } from '../lib/format';
import { INCIDENT_SOURCE_LABELS, incidentLine } from '../lib/incidents';
import type {
  MunicipalityImpact,
  OperationalIncident,
  RainForecastPoint,
  RegionImpact,
} from '../types';
import CollapsibleSection from './ui/CollapsibleSection';
import CountBadge from './ui/CountBadge';
import StatusNote from './ui/StatusNote';

interface ImpactListProps {
  impact: RegionImpact[];
  /** Lluvia prevista (72 h) por municipio con incendio relevante. */
  rainBySlug?: ReadonlyMap<string, RainForecastPoint>;
  /** Estado operativo oficial por municipio (Bombers/JCyL/EMS). */
  incidentsBySlug?: ReadonlyMap<string, OperationalIncident>;
  /** Al pulsar una localidad, el mapa vuela a sus focos. */
  onSelectMunicipality: (municipality: MunicipalityImpact) => void;
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
 * Acordeón de localidades afectadas agrupadas por comunidad autónoma (o
 * distrito, en Portugal). Dentro
 * de cada comunidad, la localidad con la detección más reciente va primero:
 * así se ve a qué municipios está llegando el fuego ahora.
 * Se usa en dos contenedores: el panel flotante de escritorio (ImpactPanel)
 * y una sección de la hoja inferior en móvil (Sidebar).
 */
export default function ImpactList({
  impact,
  rainBySlug,
  incidentsBySlug,
  onSelectMunicipality,
}: ImpactListProps) {
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
                  <li key={muni.slug}>
                    {/* Enlace real a la página indexable /incendios/<slug>
                        (rastreable); el clic sigue volando en la SPA. */}
                    <a
                      href={`/incendios/${muni.slug}`}
                      onClick={(event) => {
                        event.preventDefault();
                        onSelectMunicipality(muni);
                      }}
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
                      {/* Estado oficial del incendio (fase + medios) donde hay
                          fuente estructurada, SIEMPRE con su procedencia: el
                          satélite detecta calor; la fase la declara quien lo
                          está apagando (y pueden no coincidir). */}
                      {(() => {
                        const incident = incidentsBySlug?.get(muni.slug);
                        if (!incident) return null;
                        const line = incidentLine(incident);
                        if (!line) return null;
                        return (
                          <span
                            className={`mt-0.5 block text-micro ${
                              incident.state === 'activo' ? 'text-ink-secondary' : 'text-ink-faint'
                            }`}
                            title={incident.resourcesText}
                          >
                            {line}
                            <span className="text-ink-faint">
                              {' '}
                              · {INCIDENT_SOURCE_LABELS[incident.source]}
                            </span>
                          </span>
                        );
                      })()}
                      {/* Previsión de lluvia (solo incendios relevantes): la
                          pregunta que todo el mundo se hace ante un incendio
                          gordo, respondida también en negativo. */}
                      {(() => {
                        const rainInfo = rainBySlug?.get(muni.slug);
                        if (!rainInfo) return null;
                        return rainInfo.probMax >= RAIN_BADGE_MIN_PROB ? (
                          <span className="mt-0.5 block text-micro text-[color:var(--fm-text-link)]">
                            💧 lluvia {Math.round(rainInfo.probMax)} %{' '}
                            {formatRainDay(rainInfo.bestDate)}
                          </span>
                        ) : (
                          <span className="mt-0.5 block text-micro text-ink-faint">
                            sin lluvia prevista (3 días)
                          </span>
                        );
                      })()}
                    </a>
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
