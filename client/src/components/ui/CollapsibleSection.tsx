import type { ReactNode } from 'react';
import Icon from './Icon';

interface CollapsibleSectionProps {
  open: boolean;
  onToggle: () => void;
  /** Contenido de la cabecera (sin el chevron, que pone el componente). */
  title: ReactNode;
  /** Elemento al final de la cabecera (p. ej. un CountBadge). */
  trailing?: ReactNode;
  children: ReactNode;
}

/**
 * Sección plegable con cabecera pulsable de 44 px y chevron a la izquierda
 * que rota 90° al abrir. Renderiza un fragment para no romper el layout
 * flex/scroll del contenedor.
 */
export default function CollapsibleSection({
  open,
  onToggle,
  title,
  trailing,
  children,
}: CollapsibleSectionProps) {
  return (
    <>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-touch w-full items-center justify-between gap-2 px-4 text-left text-sm
          hover:bg-surface-hover"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Icon
            name="chevron-right"
            size={14}
            className={`shrink-0 text-ink-faint transition-transform
              duration-[var(--fm-duration-base)] motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
          />
          {title}
        </span>
        {trailing}
      </button>
      {open && children}
    </>
  );
}
