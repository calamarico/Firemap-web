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

export function confidenceLabel(confidence: string): string {
  return CONFIDENCE_LABELS[confidence.toLowerCase()] ?? confidence;
}

/** Contenido del popup de un foco de calor (se monta dentro del popup de MapLibre). */
export default function FirePopup({ fire }: { fire: FireHotspot }) {
  const rows: Array<[string, string]> = [
    ['Coordenadas', `${fire.latitude.toFixed(4)}, ${fire.longitude.toFixed(4)}`],
    ['Fecha', fire.acqDate],
    ['Hora', formatAcqTime(fire.acqTime)],
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
