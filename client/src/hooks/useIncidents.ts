import { useEffect, useState } from 'react';
import type { IncidentsResponse, OperationalIncident } from '../types';

/** Alineado con la fuente más rápida (Bombers publica cada ~10 min) y con la
 *  caché del agregador; refrescar más solo repetiría la misma respuesta. */
const INCIDENTS_REFRESH_MS = 10 * 60 * 1000;

/**
 * Estado operativo oficial (/api/incidents). Capa secundaria y mejor-esfuerzo:
 * en error se conserva el último dato bueno y se reintenta en el siguiente
 * ciclo; con la pestaña oculta no se pide nada. En el dev de Express el
 * endpoint no existe (solo Cloudflare, como /api/warm): el hook degrada a
 * lista vacía sin ruido.
 */
export function useIncidents(enabled = true): OperationalIncident[] {
  const [incidents, setIncidents] = useState<OperationalIncident[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();

    const load = async () => {
      if (document.hidden) return; // el visibilitychange de abajo re-lanza
      try {
        const res = await fetch('/api/incidents', { signal: controller.signal });
        if (!res.ok) return;
        const body = (await res.json()) as IncidentsResponse;
        if (!cancelled && Array.isArray(body.incidents)) setIncidents(body.incidents);
      } catch {
        // silencioso: el último dato bueno sigue en pantalla
      }
    };

    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    void load();
    timer = window.setInterval(() => void load(), INCIDENTS_REFRESH_MS);

    return () => {
      cancelled = true;
      controller.abort();
      document.removeEventListener('visibilitychange', onVisible);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [enabled]);

  return incidents;
}
