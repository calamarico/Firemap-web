import type { ReactNode } from 'react';
import Icon, { type IconName } from './Icon';

type StatusVariant = 'ok' | 'info' | 'loading' | 'empty' | 'warning' | 'error';

/**
 * Nota de estado del sistema: unifica los avisos, errores, cargas y vacíos
 * que antes se maquetaban a mano en cada sitio. Los colores ámbar y rojo de
 * sistema no deben aparecer fuera de este componente.
 */
interface StatusNoteProps {
  variant: StatusVariant;
  /** Primera línea en negrita (opcional). */
  title?: string;
  children?: ReactNode;
  /** Contenido del desplegable «Detalles técnicos». */
  details?: ReactNode;
  /** Atributo title nativo sobre el contenedor (tooltip). */
  tooltip?: string;
  className?: string;
}

const BOXED: Record<string, { box: string; icon: IconName; role?: 'status' | 'alert' }> = {
  empty: {
    box: 'border-edge-strong bg-surface-raised text-ink-secondary',
    icon: 'circle-slash',
  },
  warning: {
    box: 'border-warn-border bg-warn-bg text-warn-fg',
    icon: 'triangle-alert',
    role: 'status',
  },
  error: {
    box: 'border-danger-border bg-danger-bg text-danger-fg',
    icon: 'circle-x',
    role: 'alert',
  },
};

export default function StatusNote({
  variant,
  title,
  children,
  details,
  tooltip,
  className = '',
}: StatusNoteProps) {
  // Variantes sin caja: solo icono + texto de 12 px.
  if (variant === 'ok' || variant === 'info' || variant === 'loading') {
    return (
      <p
        title={tooltip}
        className={`flex items-center gap-2 text-xs ${
          variant === 'ok' ? 'text-[color:var(--fm-ok-fg)]' : 'text-ink-muted'
        } ${className}`}
      >
        {variant === 'ok' && (
          <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full bg-ok" />
        )}
        {variant === 'info' && <Icon name="info" size={14} className="shrink-0" />}
        {variant === 'loading' && (
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        )}
        <span>{children}</span>
      </p>
    );
  }

  const spec = BOXED[variant];
  return (
    <div
      role={spec.role}
      title={tooltip}
      className={`rounded-md border px-3 py-2.5 leading-relaxed ${spec.box} ${className}`}
    >
      <div className="flex gap-2">
        <Icon name={spec.icon} size={14} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          {title && <p className="text-sm font-semibold">{title}</p>}
          {children && (
            <div className={`break-words text-xs ${title ? 'mt-1' : 'text-sm'}`}>{children}</div>
          )}
          {details && (
            <details className="mt-1.5 opacity-80">
              <summary className="cursor-pointer select-none text-xs">Detalles técnicos</summary>
              <div className="mt-1 text-xs leading-relaxed [overflow-wrap:anywhere]">{details}</div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
