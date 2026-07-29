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
  // Momento del último intento (bueno o fallido): de él sale cuándo toca el
  // siguiente. Arranca "ahora" porque el efecto de abajo ya pide al montar; si
  // arrancara en 0, el planificador vería la primera carga vencida y pediría
  // los focos dos veces seguidas.
  const [settledAt, setSettledAt] = useState(() => Date.now());

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
          setSettledAt(Date.now());
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setView((v) => ({
          ...v,
          status: 'error',
          error: err instanceof Error ? err.message : 'Error desconocido al pedir los focos.',
        }));
        setSettledAt(Date.now());
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [tick]);

  /**
   * Auto-refresco, SOLO con la pestaña visible: cada ronda es una invocación de
   * Pages Functions (100.000/día en el plan free) y una pestaña olvidada en
   * segundo plano gastaba 288 al día sin que nadie mirase el mapa. Es la misma
   * defensa que ya tenían useWind y useWindField con el cupo de Open-Meteo, y
   * pesa más desde que el mapa se puede embeber: un iframe en un artículo
   * multiplica las pestañas abiertas y olvidadas.
   *
   * Al volver a ser visible, el temporizador se recalcula sobre el último
   * intento: si el dato quedó rancio se pide al instante, y si no, se apura la
   * ventana que quedaba.
   */
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      const due = Math.max(0, settledAt + refreshMs - Date.now());
      timer = window.setTimeout(refresh, due);
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [settledAt, refreshMs, refresh]);

  return { view, refresh } as const;
}
