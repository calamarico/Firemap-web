import { useEffect, useMemo, useRef, useState } from 'react';
import { WIND_REFRESH_INTERVAL_MS, WIND_RETRY_MS } from '../config';
import type { WindPoint } from '../types';

export interface WindView {
  status: 'idle' | 'loading' | 'error' | 'ready';
  /** Último dato bueno; se conserva ante errores y con el toggle apagado. */
  points: WindPoint[];
}

/**
 * Última descarga buena, persistida: si Open-Meteo no responde al cargar
 * (p. ej. cupo diario de la IP agotado, HTTP 429), se pinta esta copia en vez
 * de nada. Caduca pronto: el viento de hace horas ya no describe el presente.
 * v3: la rejilla ambiental desapareció con la pluma de humo; una caché v2
 * arrastraría sus ~86 puntos y la primera carga tras el deploy pintaría una
 * pluma en cada celda de la rejilla.
 */
const WIND_CACHE_KEY = 'fm-wind-v3';
const WIND_CACHE_TTL_MS = 60 * 60 * 1000;

interface CachedWind {
  at: number;
  fireKey: string;
  points: WindPoint[];
}

function readWindCache(): CachedWind | null {
  try {
    const raw = localStorage.getItem(WIND_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedWind;
    if (!Array.isArray(parsed.points) || Date.now() - parsed.at > WIND_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null; // localStorage inaccesible o JSON corrupto: como si no hubiera
  }
}

function writeWindCache(entry: CachedWind): void {
  try {
    localStorage.setItem(WIND_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Cuota llena o modo privado: sin copia, pero el dato ya está en memoria.
  }
}

/** Fragmento de la respuesta de Open-Meteo que consumimos. */
interface OpenMeteoEntry {
  current?: {
    wind_speed_10m?: number;
    wind_direction_10m?: number;
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Viento actual (10 m) SOLO en los puntos junto a focos, en UNA llamada
 * directa del navegador a Open-Meteo (sin API key, CORS abierto; no pasa por
 * el proxy y no gasta invocaciones del plan free).
 *
 * OJO con el cupo de Open-Meteo: son 10.000 "llamadas"/día POR IP del
 * visitante, y una petición multi-punto pondera ~1 llamada por ubicación —
 * nuestra petición (≤60 puntos, los clusters de focos) vale eso del cupo. La
 * pluma de humo eliminó la rejilla ambiental (~86 ubicaciones menos por
 * refresco). De ahí las tres defensas de este hook: cadencia de 15 min (lo
 * que tarda Open-Meteo en actualizar su "current"), pausa total con la
 * pestaña oculta (el caso "pestaña abierta todo el día" es casi siempre
 * pestaña en background), y el llamante retrasa el primer fetch hasta tener
 * los focos (una sola llamada por carga, no dos). El fallo es silencioso:
 * capa secundaria, se conserva el último dato bueno (también entre recargas,
 * vía localStorage).
 */
export function useWind(enabled: boolean, firePoints: ReadonlyArray<[number, number]>): WindView {
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<WindView>(() => {
    const cached = readWindCache();
    return cached ? { status: 'ready', points: cached.points } : { status: 'idle', points: [] };
  });
  // Al reactivar el toggle (o recargar) dentro de la ventana de frescura no
  // se refetchea: se apura la ventana con lo ya descargado.
  const lastSuccess = useRef<{ key: string; at: number } | null>(
    (() => {
      const cached = readWindCache();
      return cached ? { key: cached.fireKey, at: cached.at } : null;
    })()
  );

  // deriveFireWindSites ya devuelve orden estable y muestras redondeadas:
  // la clave solo cambia si el conjunto de clusters cambia de verdad.
  const fireKey = useMemo(() => firePoints.map((p) => p.join(',')).join(';'), [firePoints]);

  useEffect(() => {
    if (!enabled) return; // sin fetch ni timer; los puntos cacheados se conservan

    // Pestaña oculta: ni fetch ni timer — no se gasta cupo en background. Al
    // volver a ser visible se re-evalúa, y la ventana de frescura decide si
    // toca refetch o basta con lo que hay.
    if (document.hidden) {
      const onVisible = () => {
        if (!document.hidden) setTick((t) => t + 1);
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => document.removeEventListener('visibilitychange', onVisible);
    }

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
        const coords = firePoints;
        // Sin focos no hay nada que muestrear: con la URL vacía Open-Meteo
        // devolvería error y el reintento quemaría cupo para nada. (Antes la
        // rejilla ambiental garantizaba una lista no vacía.)
        if (coords.length === 0) {
          const at = Date.now();
          lastSuccess.current = { key: fireKey, at };
          writeWindCache({ at, fireKey, points: [] });
          setView({ status: 'ready', points: [] });
          schedule(WIND_REFRESH_INTERVAL_MS);
          return;
        }
        try {
          setView((v) => ({ ...v, status: 'loading' }));
          const url =
            'https://api.open-meteo.com/v1/forecast' +
            `?latitude=${coords.map(([, lat]) => lat).join(',')}` +
            `&longitude=${coords.map(([lon]) => lon).join(',')}` +
            '&current=wind_speed_10m,wind_direction_10m';
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
              speedKmh: current.wind_speed_10m,
              directionFrom: current.wind_direction_10m,
            });
          });

          if (cancelled) return;
          const at = Date.now();
          lastSuccess.current = { key: fireKey, at };
          writeWindCache({ at, fireKey, points });
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
