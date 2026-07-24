import type { FireHotspot } from '../types';

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
    ['FRP', fire.frp !== null ? `${fire.frp.toFixed(1)} MW` : '—'],
    ['Satélite', fire.satellite || '—'],
    ['Sensor', fire.instrument || '—'],
  ];

  return (
    <div className="min-w-[220px] px-3 py-2 text-sm">
      <h3 className="mb-2 border-b border-slate-700 pb-1 font-semibold text-orange-400">
        Foco de calor
      </h3>
      <dl className="space-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-slate-400">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
