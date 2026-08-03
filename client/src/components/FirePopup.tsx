import { useState, type ReactNode } from 'react';
import { RAIN_BADGE_MIN_PROB } from '../config';
import { formatRainDay, timeAgo } from '../lib/format';
import {
  distanceKm,
  INCIDENT_SOURCE_LABELS,
  incidentLine,
  matchIncidentToPoint,
} from '../lib/incidents';
import { blockContaining, sampleWindField, type WindFieldBlock } from '../lib/windField';
import type { FireHotspot, OperationalIncident, RainForecastPoint, WindPoint } from '../types';
import Icon from './ui/Icon';
import ResourceCounts from './ui/ResourceCounts';
import { SeverityChip, severityForFrp } from './ui/Severity';
import StatusBadge from './ui/StatusBadge';

const CONFIDENCE_LABELS: Record<string, string> = {
  l: 'Baja',
  n: 'Nominal',
  h: 'Alta',
};

function formatAcqTime(acqTime: string): string {
  const padded = acqTime.padStart(4, '0');
  return `${padded.slice(0, 2)}:${padded.slice(2)} UTC`;
}

/**
 * VIIRS informa la confianza por letras (l/n/h) y MODIS con un porcentaje:
 * el número se muestra tal cual con su unidad, sin inventar una equivalencia.
 */
function confidenceLabel(confidence: string): string {
  const known = CONFIDENCE_LABELS[confidence.toLowerCase()];
  if (known) return known;
  return /^\d+$/.test(confidence.trim()) ? `${confidence.trim()} %` : confidence;
}

/** Instante de la detección; FIRMS lo da en UTC (acqDate + acqTime HHMM). */
function acqInstant(fire: FireHotspot): Date | null {
  const time = fire.acqTime.padStart(4, '0');
  const date = new Date(`${fire.acqDate}T${time.slice(0, 2)}:${time.slice(2)}:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Radio máximo para dar por buena una muestra puntual (viento o lluvia) de un
 * cluster vecino: coherente con el dedupe de 0,25° (~25 km) con el que se
 * eligieron esos puntos de muestreo (lib/windPoints.ts).
 */
const NEARBY_KM = 25;

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'] as const;

/** "del NO": de dónde viene el viento, a 8 rumbos. */
function cardinalFrom(directionFrom: number): string {
  return CARDINALS[Math.round((((directionFrom % 360) + 360) % 360) / 45) % 8];
}

/**
 * Viento en la posición del foco, sin ningún fetch: el campo sinóptico
 * interpolado si la capa está cargada; si no, la muestra de Open-Meteo del
 * cluster vecino (≤25 km). Ambos son "viento en la zona", no el viento local
 * del incendio (ver el aviso de resolución en lib/windField.ts).
 */
function windAt(
  fire: FireHotspot,
  windField: WindFieldBlock[] | null | undefined,
  wind: WindPoint[] | undefined
): { speedKmh: number; directionFrom: number } | null {
  const block = windField ? blockContaining(windField, fire.longitude, fire.latitude) : null;
  if (block) {
    const s = sampleWindField(block, fire.longitude, fire.latitude);
    return { speedKmh: s.speed, directionFrom: (s.dirTo + 180) % 360 };
  }
  let best: WindPoint | null = null;
  let bestD = NEARBY_KM;
  for (const p of wind ?? []) {
    const d = distanceKm(fire.latitude, fire.longitude, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ? { speedKmh: best.speedKmh, directionFrom: best.directionFrom } : null;
}

/** Previsión de lluvia del municipio del foco (por slug) o del punto de
 *  muestreo vecino (≤25 km). Solo existe para incendios relevantes (top 20). */
function rainAt(
  fire: FireHotspot,
  rain: RainForecastPoint[] | undefined
): RainForecastPoint | null {
  if (!rain || rain.length === 0) return null;
  if (fire.muniSlug) {
    const bySlug = rain.find((p) => p.slug === fire.muniSlug);
    if (bySlug) return bySlug;
  }
  let best: RainForecastPoint | null = null;
  let bestD = NEARBY_KM;
  for (const p of rain) {
    const d = distanceKm(fire.latitude, fire.longitude, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

interface FirePopupProps {
  fire: FireHotspot;
  /** Muestras de viento junto a clusters (useWind); fallback del campo. */
  wind?: WindPoint[];
  /** Campo de flujo sinóptico; null con la capa apagada. */
  windField?: WindFieldBlock[] | null;
  /** Lluvia prevista (72 h) sobre incendios grandes. */
  rain?: RainForecastPoint[];
  /** Estado operativo oficial (Bombers/JCyL/EMS). */
  incidents?: OperationalIncident[];
  /**
   * Navegación SPA a /incendios/<slug>. Sin el callback (embed), el enlace
   * navega de verdad en una pestaña nueva.
   */
  onSelectLocality?: (name: string, slug: string) => void;
}

/**
 * Contenido del popup de un foco de calor. Card "ciudadana": responde dónde,
 * desde cuándo, cómo de grave, viento, estado oficial y lluvia — con lo que ya
 * está en memoria, sin ningún fetch. El dato técnico del satélite (coordenadas,
 * sensor, confianza) queda plegado al final.
 */
export default function FirePopup({
  fire,
  wind,
  windField,
  rain,
  incidents,
  onSelectLocality,
}: FirePopupProps) {
  const [showTech, setShowTech] = useState(false);
  const instant = acqInstant(fire);
  const level = severityForFrp(fire.frp);
  const windSample = windAt(fire, windField, wind);
  const rainInfo = rainAt(fire, rain);
  const incident =
    incidents && incidents.length > 0
      ? matchIncidentToPoint(fire.latitude, fire.longitude, incidents)
      : null;
  // "Detectado hace X": primera pasada de la ventana si el proxy la trae;
  // si no (caché vieja), la última detección — más reciente, nunca inventada.
  const firstIso = fire.firstAcqAt ?? instant?.toISOString() ?? null;

  const rows: Array<[string, ReactNode]> = [];
  if (fire.frp !== null) {
    rows.push([
      'Intensidad',
      <span className="fm-tabular font-semibold" style={{ color: `var(--fm-severity-${level})` }}>
        {fire.frp.toFixed(1)} MW
      </span>,
    ]);
  }
  if (windSample && windSample.speedKmh >= 1) {
    rows.push([
      'Viento en la zona',
      `${Math.round(windSample.speedKmh)} km/h del ${cardinalFrom(windSample.directionFrom)}`,
    ]);
  }
  if (rainInfo) {
    rows.push([
      'Lluvia (72 h)',
      rainInfo.probMax >= RAIN_BADGE_MIN_PROB
        ? `${Math.round(rainInfo.probMax)} % ${formatRainDay(rainInfo.bestDate)}`
        : 'sin lluvia prevista',
    ]);
  }

  // Fecha y hora en local, como en el ranking de localidades: mezclar UTC aquí
  // y local allí para el mismo foco solo confunde.
  const techRows: Array<[string, string]> = [
    ['Coordenadas', `${fire.latitude.toFixed(4)}, ${fire.longitude.toFixed(4)}`],
    ['Fecha', instant ? instant.toLocaleDateString('es-ES') : fire.acqDate],
    [
      'Hora',
      instant
        ? instant.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        : formatAcqTime(fire.acqTime),
    ],
    ['Confianza', confidenceLabel(fire.confidence)],
    ['Satélite', fire.satellite || '—'],
    ['Sensor', fire.instrument || '—'],
  ];

  const incidentText = incident ? incidentLine(incident) : '';

  return (
    <div className="min-w-[250px] max-w-[300px] px-3 py-2.5 text-sm">
      <div className="mb-2 flex items-start justify-between gap-3 border-b border-edge-strong pb-2">
        <div className="min-w-0">
          {fire.muniName ? (
            <>
              <p className="fm-eyebrow text-ink-faint">Foco de calor</p>
              <h3 className="truncate text-sm font-bold text-ink-primary">{fire.muniName}</h3>
              {fire.muniRegion && <p className="text-micro text-ink-faint">{fire.muniRegion}</p>}
            </>
          ) : (
            <h3 className="text-sm font-bold text-ink-primary">Foco de calor</h3>
          )}
        </div>
        <SeverityChip level={level} size="sm" className="mt-0.5 shrink-0" />
      </div>

      {firstIso && (
        <p className="mb-2 text-xs text-ink-secondary">
          Detectado por satélite{' '}
          <span className="font-medium text-ink-primary">{timeAgo(firstIso)}</span>
          {fire.detections !== undefined && fire.detections > 1 && (
            <span className="text-ink-muted"> · visto en {fire.detections} pasadas (24 h)</span>
          )}
        </p>
      )}

      {rows.length > 0 && (
        <dl className="space-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Estado oficial del incendio (StatusBadge md, handoff 2026-08-03),
          SIEMPRE con su procedencia visible como fila propia: el satélite
          detecta calor; la fase la declara quien lo está apagando. Con parte
          sin fase (state null, no-EMS) solo se muestran medios + fuente. */}
      {incident && incidentText && (
        <div className="mt-2 space-y-1 border-t border-edge-strong pt-2 text-micro">
          <div className="flex items-center justify-between gap-4">
            <span className="text-ink-muted">Estado oficial</span>
            {incident.source === 'copernicus-ems' ? (
              <StatusBadge state="ems" level={incident.level} size="md" />
            ) : incident.state ? (
              <StatusBadge state={incident.state} level={incident.level} size="md" />
            ) : (
              <span className="text-ink-faint">sin fase en el último parte</span>
            )}
          </div>
          {(incident.resources || incident.resourcesText) && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-ink-muted">Medios</span>
              {incident.resources ? (
                <ResourceCounts size="md" {...incident.resources} />
              ) : (
                <span
                  className="max-w-[170px] truncate text-ink-secondary"
                  title={incident.resourcesText}
                >
                  {incident.resourcesText}
                </span>
              )}
            </div>
          )}
          <p className="text-ink-faint">Fuente: {INCIDENT_SOURCE_LABELS[incident.source]}</p>
        </div>
      )}

      {fire.muniSlug && fire.muniName && (
        <a
          href={`/incendios/${fire.muniSlug}`}
          target={onSelectLocality ? undefined : '_blank'}
          rel={onSelectLocality ? undefined : 'noopener'}
          onClick={
            onSelectLocality
              ? (event) => {
                  event.preventDefault();
                  onSelectLocality(fire.muniName!, fire.muniSlug!);
                }
              : undefined
          }
          className="mt-2 flex items-center gap-0.5 py-1 text-xs font-medium
            text-[color:var(--fm-text-link)] underline-offset-2 hover:text-[color:var(--fm-text-link-hover)]
            hover:underline"
        >
          Ver situación de la zona
          <Icon name="chevron-right" size={13} />
        </a>
      )}

      <button
        onClick={() => setShowTech((v) => !v)}
        aria-expanded={showTech}
        className="mt-1 flex items-center gap-1 py-1 text-micro text-ink-faint hover:text-ink-muted"
      >
        <Icon
          name="chevron-right"
          size={12}
          className={`transition-transform duration-[var(--fm-duration-base)]
            motion-reduce:transition-none ${showTech ? 'rotate-90' : ''}`}
        />
        Datos del satélite
      </button>
      {showTech && (
        <dl className="mt-1 space-y-1 border-t border-edge-subtle pt-1.5">
          {techRows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 text-xs">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
