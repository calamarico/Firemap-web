import { useEffect, useRef, useState } from 'react';
import Button from './Button';
import Icon, { type IconName } from './Icon';

/**
 * Menú de acciones sobre el mapa COMO DOCUMENTO: compartir la vista, compartir
 * la localidad y llevarse el mapa a otra web. No es un control del mapa (no
 * cambia lo que se pinta) y por eso no vive en el bloque de capas: va emparejado
 * con la acción primaria del panel, donde el color y el ancho dejan claro cuál
 * de las dos manda.
 *
 * Sustituye al botón suelto «Insertar este mapa en tu web», que repetía la forma
 * del primario y colgaba del grupo equivocado.
 *
 * Componente de UI genérico: la construcción de las URLs vive fuera (lib/share.ts).
 */
export interface ShareMenuItem {
  id: string;
  /** Sentence case, sin punto final. */
  label: string;
  /** Segunda línea: qué se lleva exactamente quien pulsa. */
  hint?: string;
  icon: IconName;
  /** Con href el ítem NAVEGA (se renderiza <a> real, abrible en otra pestaña). */
  href?: string;
  /**
   * Sin href: texto que se copia. El ítem confirma en sí mismo con «Copiado».
   *
   * Admite función porque «enlace de esta vista» depende del hash `#map=` que
   * MapView escribe con history.replaceState, y eso NO provoca re-render: una
   * cadena calculada en el render se copiaría con el encuadre de hace dos
   * paneos. Con función, el valor se resuelve al pulsar.
   */
  value?: string | (() => string);
  /** Un solo ítem destacado por menú. */
  featured?: boolean;
}

interface ShareMenuProps {
  items: ShareMenuItem[];
  label?: string;
  className?: string;
}

/** Lo que dura la confirmación en el propio ítem. */
const FEEDBACK_MS = 2400;
const COPY_FAILED_HINT = 'No se ha podido copiar; selecciona el enlace a mano.';

export default function ShareMenu({ items, label = 'Compartir', className = '' }: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  /** Ítem que acaba de responder (por id, no por índice: la lista cambia con la localidad). */
  const [feedback, setFeedback] = useState<{ id: string; ok: boolean } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // El foco vuelve al disparador al cerrar. Se busca por su semántica
  // (aria-haspopup) y no por posición: Button no reenvía ref, y añadírselo por
  // esto obligaría a tocar un componente compartido con props en unión.
  //
  // Diferido un tick a propósito: al cerrar por pulsación fuera, el navegador
  // mueve el foco al elemento pulsado DESPUÉS del pointerdown —y el canvas de
  // MapLibre es focusable—, así que enfocar en el mismo tick no dejaría rastro.
  // No hay efecto visual indeseado: tras una pulsación de ratón :focus-visible
  // no se activa, así que no aparece el anillo.
  const focusTrigger = () => {
    window.setTimeout(() => {
      boxRef.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
    }, 0);
  };

  const close = () => {
    setOpen(false);
    focusTrigger();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const copy = async (item: ShareMenuItem) => {
    try {
      await navigator.clipboard.writeText(
        (typeof item.value === 'function' ? item.value() : item.value) ?? ''
      );
      setFeedback({ id: item.id, ok: true });
    } catch {
      // Sin permiso de portapapeles (o sin TLS): se avisa en el propio ítem. No
      // hay toasts en el sistema y no se inventan para esto.
      setFeedback({ id: item.id, ok: false });
    }
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <Button
        variant="secondary"
        size="lg"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="share-2" size={14} />
        {label}
      </Button>

      {open && (
        // 320 px anclados al borde derecho del disparador: cabe dentro de los
        // 384 px del panel sin desbordarlo por ningún lado.
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+var(--fm-space-4))] z-popup w-80
            overflow-hidden rounded-lg border border-edge bg-surface-raised shadow-popup"
        >
          {items.map((item, index) => {
            const copied = feedback?.id === item.id && feedback.ok;
            const failed = feedback?.id === item.id && !feedback.ok;
            const content = (
              <>
                <span
                  className={`mt-0.5 shrink-0 ${item.featured ? 'text-action-fg' : 'text-ink-muted'}`}
                >
                  <Icon name={copied ? 'check' : item.icon} size={16} />
                </span>
                <span className="min-w-0">
                  <strong className="block text-sm font-semibold">
                    {copied ? 'Copiado' : item.label}
                  </strong>
                  {item.hint && (
                    <span className="mt-0.5 block text-micro leading-snug text-ink-muted">
                      {failed ? COPY_FAILED_HINT : item.hint}
                    </span>
                  )}
                </span>
              </>
            );
            const itemClasses = `flex min-h-touch w-full items-start gap-2.5 px-3 py-3 text-left
              ${item.featured ? 'bg-action-subtle text-action-fg' : 'text-ink-primary hover:bg-surface-hover'}
              ${index < items.length - 1 ? 'border-b border-edge-subtle' : ''}`;

            // Los que navegan son enlaces reales (abribles en otra pestaña y
            // rastreables); los que copian son botones. Un <a href="#"> con
            // preventDefault se anunciaría como enlace sin serlo.
            return item.href ? (
              <a key={item.id} role="menuitem" href={item.href} className={itemClasses}>
                {content}
              </a>
            ) : (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => void copy(item)}
                className={itemClasses}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
