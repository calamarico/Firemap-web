interface MetricProps {
  label: string;
  /** Aclaración bajo la etiqueta. */
  hint?: string;
  value: number | string | null;
  /** Unidad separada de la cifra (MW, ha...). */
  unit?: string;
  size?: 'md' | 'lg' | 'xl';
  /**
   * `brand` (naranja ember) queda reservado a la cifra titular de focos
   * activos; el resto de métricas van en `neutral` o un token de severidad.
   */
  tone?: 'neutral' | 'brand';
  className?: string;
}

const SIZE_CLASSES = { md: 'text-metric-md', lg: 'text-metric-lg', xl: 'text-metric-xl' };

/** Par etiqueta-cifra alineado por línea base, con la cifra en tabular. */
export default function Metric({
  label,
  hint,
  value,
  unit,
  size = 'md',
  tone = 'neutral',
  className = '',
}: MetricProps) {
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-ink-muted">{label}</span>
        <span
          className={`fm-metric shrink-0 ${SIZE_CLASSES[size]} ${
            value === null ? 'text-ink-faint' : tone === 'brand' ? 'text-ember-text' : 'text-ink-primary'
          }`}
        >
          {value ?? '—'}
          {unit && value !== null && (
            <span className="ml-1 text-xs font-semibold text-ink-muted">{unit}</span>
          )}
        </span>
      </div>
      {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}
