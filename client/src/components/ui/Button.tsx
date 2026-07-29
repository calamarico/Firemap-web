import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

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

const BASE_CLASSES = `inline-flex items-center justify-center gap-2 rounded-md font-semibold
  transition-colors duration-[var(--fm-duration-fast)] ease-[var(--fm-ease-standard)]
  disabled:cursor-not-allowed disabled:opacity-[var(--fm-disabled-opacity)]`;

interface CommonProps {
  variant?: ButtonVariant;
  /** En móvil usar siempre `lg` (objetivo táctil de 44 px). */
  size?: ButtonSize;
  /** Muestra un spinner junto al texto y bloquea el botón. */
  loading?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * Con `href` el componente pinta un <a> con la misma piel. Es lo que hace falta
 * cuando la acción es "ir a otra página" (p. ej. el acceso a /insertar desde el
 * panel): un <button> con onClick+location sería un enlace mentiroso —sin
 * "abrir en pestaña nueva", sin copiar dirección y sin decirle a un lector de
 * pantalla que navega—. La alternativa, un <a> con las clases copiadas a mano,
 * dejaría fuera del sistema de variantes a ese enlace en cuanto cambie el
 * handoff de diseño.
 */
type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: never };
type LinkProps = CommonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

export default function Button(props: ButtonProps | LinkProps) {
  const { variant = 'primary', size = 'md', loading = false, className = '', children } = props;
  const classes = `${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`;
  const spinner = loading ? (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  ) : null;

  if (props.href !== undefined) {
    const { variant: _v, size: _s, loading: _l, className: _c, children: _ch, ...anchor } = props;
    return (
      <a className={classes} {...anchor}>
        {spinner}
        {children}
      </a>
    );
  }

  const { variant: _v, size: _s, loading: _l, className: _c, children: _ch, ...button } = props;
  return (
    <button disabled={button.disabled || loading} className={classes} {...button}>
      {spinner}
      {children}
    </button>
  );
}
