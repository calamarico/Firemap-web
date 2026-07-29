import { useCallback, useEffect, useState } from 'react';
import { EffisStatus } from '../types';

export interface EffisView {
  status: 'loading' | 'error' | 'ready';
  data: EffisStatus | null;
  error: string | null;
}

/**
 * Reintento acelerado mientras el servicio de perímetros esté caído. Sigue
 * siendo más rápido que el refresco normal, pero sin bajar del margen que
 * protege la quota de invocaciones del plan free (EFFIS puede pasarse horas
 * caído y cada sondeo de cada visitante es una invocación).
 */
const RETRY_WHEN_DOWN_MS = 3 * 60 * 1000;

/**
 * Consulta la disponibilidad de EFFIS al proxy. Si el servicio está caído, la
 * app sigue funcionando solo con FIRMS: este hook solo informa, nunca lanza.
 * El sondeo es adaptativo: cadencia normal con servicio vivo, cada 3 minutos
 * cuando está caído (EFFIS se cae a menudo y queremos recuperarlo pronto).
 */
export function useEffisStatus(refreshMs: number) {
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<EffisView>({ status: 'loading', data: null, error: null });

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let timer: number | undefined;
    let stopWaiting: (() => void) | undefined;

    (async () => {
      let nextDelay = refreshMs;
      try {
        const res = await fetch('/api/effis/status', { signal: controller.signal });
        if (!res.ok) throw new Error(`El proxy devolvió HTTP ${res.status}.`);
        const body = (await res.json()) as EffisStatus;
        if (!cancelled) setView({ status: 'ready', data: body, error: null });
        if (!body.available) nextDelay = RETRY_WHEN_DOWN_MS;
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        nextDelay = RETRY_WHEN_DOWN_MS;
        setView((v) => ({
          ...v,
          status: 'error',
          error: err instanceof Error ? err.message : 'Error consultando el estado de EFFIS.',
        }));
      } finally {
        if (cancelled) return;
        // Pestaña oculta: el sondeo no se reprograma (cada uno es una
        // invocación de las 100.000/día del plan free, y con el mapa embebido
        // en artículos hay muchas más pestañas olvidadas en segundo plano). Se
        // retoma en cuanto vuelve a primer plano.
        if (document.hidden) {
          const onVisible = () => {
            if (document.hidden) return;
            document.removeEventListener('visibilitychange', onVisible);
            refresh();
          };
          document.addEventListener('visibilitychange', onVisible);
          stopWaiting = () => document.removeEventListener('visibilitychange', onVisible);
        } else {
          timer = window.setTimeout(refresh, nextDelay);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
      stopWaiting?.();
    };
  }, [tick, refreshMs, refresh]);

  return { view, refresh } as const;
}
