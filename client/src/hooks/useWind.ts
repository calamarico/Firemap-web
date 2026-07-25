import { useEffect, useMemo, useRef, useState } from 'react';
import { WIND_REFRESH_INTERVAL_MS, WIND_RETRY_MS } from '../config';
import windGrid from '../map/windGrid.json';
import type { WindPoint } from '../types';

export interface WindView {
  status: 'idle' | 'loading' | 'error' | 'ready';
  /** Último dato bueno; se conserva ante errores y con el toggle apagado. */
  points: WindPoint[];
}

/**
 * Rejilla fija de muestreo sobre tierra (generada por scripts/build-wind-grid.mjs).
 * Va empaquetada en el bundle: pedirla como /data/*.json pasaría por el
 * catch-all de Pages Functions y gastaría una invocación por visita.
 */
const GRID_POINTS = windGrid.points.map(([lon, lat]): [number, number] => [lon, lat]);

/** Fragmento de la respuesta de Open-Meteo que consumimos. */
interface OpenMeteoEntry {
  current?: {
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    wind_gusts_10m?: number;
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Viento actual (10 m) para la rejilla de España + los puntos junto a focos,
 * en UNA llamada directa del navegador a Open-Meteo (sin API key, CORS
 * abierto; no pasa por el proxy y no gasta invocaciones del plan free).
 *
 * Cadencia propia de 15 min (lo que tarda Open-Meteo en actualizar su
 * "current"), con reintento corto si falla. Capa secundaria: el fallo es
 * silencioso y se conserva el último dato bueno, nunca se avisa en la UI.
 */
export function useWind(enabled: boolean, firePoints: ReadonlyArray<[number, number]>): WindView {
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<WindView>({ status: 'idle', points: [] });
  // Última descarga buena: al reactivar el toggle dentro de la ventana de
  // frescura no se refetchea, se apura la ventana con lo ya descargado.
  const lastSuccess = useRef<{ key: string; at: number } | null>(null);

  // deriveFireWindPoints ya devuelve orden estable y coordenadas redondeadas:
  // la clave solo cambia si el conjunto de clusters cambia de verdad.
  const fireKey = useMemo(() => firePoints.map((p) => p.join(',')).join(';'), [firePoints]);

  useEffect(() => {
    if (!enabled) return; // sin fetch ni timer; los puntos cacheados se conservan

    const controller = new AbortController();
    let cancelled = false;
    let timer: number | undefined;
    const schedule = (ms: number) => {
      if (!cancelled) timer = window.setTimeout(() => setTick((t) => t + 1), ms);
    };

    const last = lastSuccess.current;
    const freshFor =
      last && last.key === fireKey ? last.at + WIND_REFRESH_INTERVAL_MS - Date.now() : 0;
    if (freshFor > 0) {
      schedule(freshFor);
    } else {
      (async () => {
        const coords = [...GRID_POINTS, ...firePoints];
        try {
          setView((v) => ({ ...v, status: 'loading' }));
          const url =
            'https://api.open-meteo.com/v1/forecast' +
            `?latitude=${coords.map(([, lat]) => lat).join(',')}` +
            `&longitude=${coords.map(([lon]) => lon).join(',')}` +
            '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m';
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) throw new Error(`Open-Meteo devolvió HTTP ${res.status}.`);
          const body: unknown = await res.json();
          // Con una sola ubicación Open-Meteo devuelve un objeto, no un array.
          const list = (Array.isArray(body) ? body : [body]) as OpenMeteoEntry[];
          if (list.length !== coords.length) {
            throw new Error('Open-Meteo devolvió un número de ubicaciones inesperado.');
          }

          const points: WindPoint[] = [];
          list.forEach((entry, i) => {
            const current = entry?.current;
            if (!finite(current?.wind_speed_10m) || !finite(current?.wind_direction_10m)) return;
            const [lon, lat] = coords[i];
            points.push({
              lon,
              lat,
              kind: i < GRID_POINTS.length ? 'grid' : 'fire',
              speedKmh: current.wind_speed_10m,
              directionFrom: current.wind_direction_10m,
              gustKmh: finite(current.wind_gusts_10m) ? current.wind_gusts_10m : null,
            });
          });

          if (cancelled) return;
          lastSuccess.current = { key: fireKey, at: Date.now() };
          setView({ status: 'ready', points });
          schedule(WIND_REFRESH_INTERVAL_MS);
        } catch {
          if (cancelled || controller.signal.aborted) return;
          setView((v) => ({ ...v, status: 'error' }));
          schedule(WIND_RETRY_MS);
        }
      })();
    }

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, fireKey, tick]); // eslint-disable-line react-hooks/exhaustive-deps -- firePoints está representado por fireKey

  return view;
}
