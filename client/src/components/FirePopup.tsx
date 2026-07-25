import type { FireHotspot } from '../types';
import { SeverityChip, severityForFrp } from './ui/Severity';

const CONFIDENCE_LABELS: Record<string, string> = {
  l: 'Baja',
  n: 'Nominal',
  h: 'Alta',
};

export function formatAcqTime(acqTime: string): string {
  const padded = acqTime.padStart(4, '0');
  return `${padded.slice(0, 2)}:${padded.slice(2)} UTC`;
}

/**
 * VIIRS informa la confianza por letras (l/n/h) y MODIS con un porcentaje:
 * el número se muestra tal cual con su unidad, sin inventar una equivalencia.
 */
export function confidenceLabel(confidence: string): string {
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

/** Contenido del popup de un foco de calor (se monta dentro del popup de MapLibre). */
export default function FirePopup({ fire }: { fire: FireHotspot }) {
  // Fecha y hora en local, como en el ranking de localidades: mezclar UTC aquí
  // y local allí para el mismo foco solo confunde.
  const instant = acqInstant(fire);
  const level = severityForFrp(fire.frp);
  const rows: Array<[string, string]> = [
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

  return (
    <div className="min-w-[240px] px-3 py-2 text-sm">
      <div className="mb-1.5 flex items-center justify-between gap-3 border-b border-edge-strong pb-1.5">
        <h3 className="text-sm font-bold text-ink-primary">Foco de calor</h3>
        <SeverityChip level={level} size="sm" />
      </div>
      {/* El dato que decide (FRP) preside el popup, coloreado por severidad. */}
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span>
          <span
            className="fm-metric text-metric-md"
            style={{ color: `var(--fm-severity-${level})` }}
          >
            {fire.frp !== null ? fire.frp.toFixed(1) : '—'}
          </span>
          <span className="ml-1 text-xs font-semibold text-ink-muted">MW</span>
        </span>
        <span className="text-micro text-ink-faint">potencia radiativa</span>
      </div>
      <dl className="space-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
