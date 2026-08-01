import { useEffect, useMemo, useRef, useState } from 'react';
import { RAIN_REFRESH_INTERVAL_MS, RAIN_RETRY_MS } from '../config';
import type { RainSite } from '../lib/windPoints';
import type { RainForecastPoint } from '../types';

export interface RainView {
  status: 'idle' | 'loading' | 'error' | 'ready';
  /** Último dato bueno; se conserva ante errores. Ya cruzado con los sitios actuales. */
  points: RainForecastPoint[];
}

/**
 * Lo que se persiste es el dato meteorológico por coordenada de muestreo; el
 * slug/nombre del municipio se cruza SIEMPRE con los sitios vigentes al
 * devolver — una caché de hace 2 h no debe imponer municipios que ya salieron
 * del ranking.
 */
interface RainDatum {
  lon: number;
  lat: number;
  probMax: number;
  bestDate: string;
  sumMm: number;
}

const RAIN_CACHE_KEY = 'fm-rain-v1';
/** La previsión diaria envejece despacio; 3 h alinea con la cadencia de refresco. */
const RAIN_CACHE_TTL_MS = 3 * 60 * 60 * 1000;

interface CachedRain {
  at: number;
  rainKey: string;
  data: RainDatum[];
}

function readRainCache(): CachedRain | null {
  try {
    const raw = localStorage.getItem(RAIN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRain;
    if (!Array.isArray(parsed.data) || Date.now() - parsed.at > RAIN_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null; // localStorage inaccesible o JSON corrupto: como si no hubiera
  }
}

function writeRainCache(entry: CachedRain): void {
  try {
    localStorage.setItem(RAIN_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Cuota llena o modo privado: sin copia, pero el dato ya está en memoria.
  }
}

/** Fragmento de la respuesta `daily` de Open-Meteo que consumimos. */
interface OpenMeteoDailyEntry {
  daily?: {
    time?: string[];
    precipitation_probability_max?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
  };
}

/**
 * Previsión de lluvia (72 h) SOLO sobre los municipios con incendio relevante
 * (deriveRainSites), en UNA llamada directa del navegador a Open-Meteo.
 *
 * Cupo: 2 variables `daily` × 3 días con el suelo conservador de 14 días del
 * factor temporal → 0,2 por ubicación; ≤20 ubicaciones = ≤4 ponderadas por
 * refresco, cada 3 h (≈32/día, ~0,3 % del cupo de 10.000 de la IP del
 * visitante). NUNCA fusionar estas variables con la petición de useWind: su
 * cadencia de 15 min multiplicaría el coste ×36. Mismas tres defensas que los
 * hooks de viento: ventana de frescura persistida, pausa total con la pestaña
 * oculta, y el llamante retrasa el primer fetch hasta tener los focos.
 */
export function useRainForecast(enabled: boolean, sites: RainSite[]): RainView {
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<RainDatum[]>(() => readRainCache()?.data ?? []);
  const [status, setStatus] = useState<RainView['status']>(() =>
    readRainCache() ? 'ready' : 'idle'
  );
  const lastSuccess = useRef<{ key: string; at: number } | null>(
    (() => {
      const cached = readRainCache();
      return cached ? { key: cached.rainKey, at: cached.at } : null;
    })()
  );

  // deriveRainSites devuelve orden estable y muestras redondeadas: la clave
  // solo cambia si el conjunto de incendios relevantes cambia de verdad.
  const rainKey = useMemo(() => sites.map((s) => s.sample.join(',')).join(';'), [sites]);
  const samples = useMemo(() => sites.map((s) => s.sample), [sites]);

  useEffect(() => {
    if (!enabled) return;

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
      last && last.key === rainKey ? last.at + RAIN_REFRESH_INTERVAL_MS - Date.now() : 0;
    if (freshFor > 0) {
      schedule(freshFor);
    } else {
      (async () => {
        // Sin incendios relevantes no hay nada que preguntar: la URL vacía
        // devolvería error y el reintento quemaría cupo para nada.
        if (samples.length === 0) {
          const at = Date.now();
          lastSuccess.current = { key: rainKey, at };
          writeRainCache({ at, rainKey, data: [] });
          setData([]);
          setStatus('ready');
          schedule(RAIN_REFRESH_INTERVAL_MS);
          return;
        }
        try {
          setStatus('loading');
          const url =
            'https://api.open-meteo.com/v1/forecast' +
            `?latitude=${samples.map(([, lat]) => lat).join(',')}` +
            `&longitude=${samples.map(([lon]) => lon).join(',')}` +
            '&daily=precipitation_probability_max,precipitation_sum' +
            '&forecast_days=3&timezone=UTC';
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) throw new Error(`Open-Meteo devolvió HTTP ${res.status}.`);
          const body: unknown = await res.json();
          // Con una sola ubicación Open-Meteo devuelve un objeto, no un array.
          const list = (Array.isArray(body) ? body : [body]) as OpenMeteoDailyEntry[];
          if (list.length !== samples.length) {
            throw new Error('Open-Meteo devolvió un número de ubicaciones inesperado.');
          }

          const next: RainDatum[] = [];
          list.forEach((entry, i) => {
            const daily = entry?.daily;
            const time = daily?.time ?? [];
            const probs = daily?.precipitation_probability_max ?? [];
            const sums = daily?.precipitation_sum ?? [];
            let probMax = -1;
            let bestDate = '';
            let sumMm = 0;
            time.forEach((date, d) => {
              const p = probs[d];
              if (typeof p === 'number' && p > probMax) {
                probMax = p;
                bestDate = date;
              }
              const s = sums[d];
              if (typeof s === 'number') sumMm += s;
            });
            if (probMax < 0) return; // sin probabilidad en ningún día: se omite el punto
            const [lon, lat] = samples[i];
            next.push({ lon, lat, probMax, bestDate, sumMm: Math.round(sumMm * 10) / 10 });
          });

          if (cancelled) return;
          const at = Date.now();
          lastSuccess.current = { key: rainKey, at };
          writeRainCache({ at, rainKey, data: next });
          setData(next);
          setStatus('ready');
          schedule(RAIN_REFRESH_INTERVAL_MS);
        } catch {
          if (cancelled || controller.signal.aborted) return;
          setStatus('error');
          schedule(RAIN_RETRY_MS);
        }
      })();
    }

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, rainKey, tick]); // eslint-disable-line react-hooks/exhaustive-deps -- samples está representado por rainKey

  // Cruce con los sitios VIGENTES: el slug/nombre siempre es el del ranking
  // actual, aunque el dato meteo venga de la caché.
  const points = useMemo(() => {
    const bySample = new Map(data.map((d) => [`${d.lon},${d.lat}`, d]));
    const out: RainForecastPoint[] = [];
    for (const site of sites) {
      const datum = bySample.get(site.sample.join(','));
      if (datum) out.push({ ...datum, slug: site.slug, name: site.name });
    }
    return out;
  }, [data, sites]);

  return { status, points };
}
