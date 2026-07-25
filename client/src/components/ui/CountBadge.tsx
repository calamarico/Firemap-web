type BadgeTone = 'ember' | 'neutral' | 'accent';
type BadgeSize = 'sm' | 'md';

const TONE_CLASSES: Record<BadgeTone, string> = {
  ember: 'bg-ember-subtle text-ember-text',
  neutral: 'bg-surface-raised text-ink-secondary',
  accent: 'bg-action-subtle text-action-fg',
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'min-w-[22px] px-2 py-0.5 text-xs',
  md: 'min-w-[26px] px-2.5 py-0.5 text-sm',
};

interface CountBadgeProps {
  value: number | null;
  /** Qué cuenta el número: el dígito solo no se lo dice a un lector de pantalla. */
  label: string;
  tone?: BadgeTone;
  size?: BadgeSize;
  className?: string;
}

/** Píldora de recuento (focos activos, focos por comunidad...). */
export default function CountBadge({
  value,
  label,
  tone = 'ember',
  size = 'md',
  className = '',
}: CountBadgeProps) {
  return (
    <span
      aria-label={label}
      className={`inline-block rounded-full text-center font-bold tabular-nums
        ${TONE_CLASSES[tone]} ${SIZE_CLASSES[size]} ${className}`}
    >
      {value ?? '—'}
    </span>
  );
}
