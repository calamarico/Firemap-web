import { useCallback, useEffect, useState } from 'react';
import { FiresResponse, isApiErrorBody } from '../types';

export interface FiresView {
  status: 'loading' | 'error' | 'ready';
  /** Se conserva el último dato bueno mientras se recarga o si falla el refresco. */
  data: FiresResponse | null;
  error: string | null;
  lastUpdated: Date | null;
}

/**
 * Carga los focos del proxy (vista fija de "momento actual": últimas 24 h),
 * con auto-refresco periódico y refresco manual. El intervalo se reinicia tras
 * cada carga (automática o manual), así nunca hay dos peticiones pegadas.
 */
export function useFires(refreshMs: number) {
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<FiresView>({
    status: 'loading',
    data: null,
    error: null,
    lastUpdated: null,
  });

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setView((v) => ({ ...v, status: 'loading', error: null }));
    (async () => {
      try {
        const res = await fetch('/api/fires', { signal: controller.signal });
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const message = isApiErrorBody(body)
            ? body.error.message
            : `El proxy devolvió HTTP ${res.status}.`;
          throw new Error(message);
        }
        if (!cancelled) {
          setView({
            status: 'ready',
            data: body as FiresResponse,
            error: null,
            lastUpdated: new Date(),
          });
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setView((v) => ({
          ...v,
          status: 'error',
          error: err instanceof Error ? err.message : 'Error desconocido al pedir los focos.',
        }));
      }
    })();

    const intervalId = window.setInterval(refresh, refreshMs);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [tick, refreshMs, refresh]);

  return { view, refresh } as const;
}
