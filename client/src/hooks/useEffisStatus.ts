import { useCallback, useEffect, useState } from 'react';
import { EffisStatus } from '../types';

export interface EffisView {
  status: 'loading' | 'error' | 'ready';
  data: EffisStatus | null;
  error: string | null;
}

/** Reintento acelerado mientras el servicio de perímetros esté caído. */
const RETRY_WHEN_DOWN_MS = 60 * 1000;

/**
 * Consulta la disponibilidad de EFFIS al proxy. Si el servicio está caído, la
 * app sigue funcionando solo con FIRMS: este hook solo informa, nunca lanza.
 * El sondeo es adaptativo: cadencia normal con servicio vivo, cada minuto
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
        if (!cancelled) timer = window.setTimeout(refresh, nextDelay);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [tick, refreshMs, refresh]);

  return { view, refresh } as const;
}
