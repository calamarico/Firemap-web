import { useState } from 'react';
import Icon from './ui/Icon';

/**
 * Aviso TEMPORAL del rebrand (fase 1 de la migración a radarincendios.com):
 * anuncia el cambio de nombre y dominio unos días antes del switchover. Se
 * elimina entero en el commit de migración (fase 2) — no dejar tras el cambio.
 * Sin enlace a propósito: el dominio nuevo aún no sirve contenido.
 */
const DISMISS_KEY = 'fm-rebrand-notice';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false; // localStorage inaccesible: se muestra (y no persistirá el cierre)
  }
}

export default function RebrandNotice() {
  const [dismissed, setDismissed] = useState(wasDismissed);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // sin persistencia: volverá a aparecer en la próxima visita, aceptable
    }
  };

  return (
    <section
      className="flex items-start gap-2 rounded-md border border-edge bg-surface-sunken
        px-3 py-2 text-xs text-ink-secondary"
    >
      <span aria-hidden="true" className="shrink-0">
        🔥
      </span>
      <p className="min-w-0 flex-1">
        Firemaps pasa a llamarse{' '}
        <strong className="font-semibold text-ink-primary">Radar de Incendios</strong>. Muy pronto
        nos encontrarás en <strong className="font-semibold text-ink-primary">radarincendios.com</strong>{' '}
        — mismo mapa, nueva casa.
      </p>
      <button
        onClick={dismiss}
        aria-label="Cerrar el aviso"
        title="Cerrar"
        className="shrink-0 rounded p-0.5 text-ink-muted hover:text-ink-primary"
      >
        <Icon name="x" size={14} />
      </button>
    </section>
  );
}
