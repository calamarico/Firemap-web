import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-action text-[color:var(--fm-text-on-accent)] hover:bg-action-hover active:bg-action-active',
  secondary:
    'border border-edge-strong bg-surface-raised text-ink-secondary hover:border-[color:var(--fm-border-interactive)]',
  ghost: 'bg-transparent text-ink-secondary hover:bg-surface-hover',
  danger: 'border border-danger-border bg-danger-bg text-danger-fg',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-[32px] px-3 text-xs',
  md: 'min-h-[40px] px-4 text-sm',
  lg: 'min-h-[44px] px-5 text-sm',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** En móvil usar siempre `lg` (objetivo táctil de 44 px). */
  size?: ButtonSize;
  /** Muestra un spinner junto al texto y bloquea el botón. */
  loading?: boolean;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-semibold
        transition-colors duration-[var(--fm-duration-fast)] ease-[var(--fm-ease-standard)]
        disabled:cursor-not-allowed disabled:opacity-[var(--fm-disabled-opacity)]
        ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
