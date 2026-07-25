import { SEVERITY, type SeverityLevel } from '../../styles/mapTokens';

/** Nivel de severidad por potencia radiativa (MW). Sin dato se asume el nivel más bajo. */
export function severityForFrp(frp: number | null): SeverityLevel {
  if (frp === null) return 1;
  if (frp < 5) return 1;
  if (frp < 20) return 2;
  if (frp < 50) return 3;
  return 4;
}

interface SeverityChipProps {
  level: SeverityLevel;
  variant?: 'solid' | 'outline';
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Chip de severidad. El color nunca va solo: el chip siempre lleva la
 * palabra (Baja / Moderada / Alta / Extrema).
 */
export function SeverityChip({
  level,
  variant = 'solid',
  size = 'md',
  className = '',
}: SeverityChipProps) {
  const label = SEVERITY[level - 1].label;
  const sizeClasses = size === 'md' ? 'px-2.5 py-[3px] text-xs' : 'px-[7px] py-px text-micro';

  if (variant === 'outline') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${sizeClasses} ${className}`}
        style={{
          borderColor: `var(--fm-severity-${level})`,
          color: `var(--fm-severity-${level})`,
        }}
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: `var(--fm-severity-${level})` }}
        />
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-block rounded-full font-semibold ${sizeClasses} ${className}`}
      style={{
        backgroundColor: `var(--fm-severity-${level})`,
        color: `var(--fm-severity-${level}-fg)`,
      }}
    >
      {label}
    </span>
  );
}

interface SeverityDotProps {
  /** Nivel FRP; alternativa a `color`. */
  level?: SeverityLevel;
  /** Color CSS explícito (p. ej. `var(--fm-burnt-fill)` para el área quemada). */
  color?: string;
  /** `square` para el área quemada; réplica del símbolo del mapa. */
  shape?: 'circle' | 'square';
  /** Lado en px. */
  size?: number;
  className?: string;
}

/** Punto de severidad: réplica exacta del círculo que pinta el mapa. */
export function SeverityDot({
  level,
  color,
  shape = 'circle',
  size = 14,
  className = '',
}: SeverityDotProps) {
  const background = color ?? (level ? `var(--fm-severity-${level})` : undefined);
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 border ${
        shape === 'circle' ? 'rounded-full' : 'rounded-[var(--fm-radius-xs)]'
      } ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: background,
        borderColor: 'var(--fm-severity-stroke)',
      }}
    />
  );
}
