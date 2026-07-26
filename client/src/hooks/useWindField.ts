import { useEffect, useRef, useState } from 'react';
import { WIND_FIELD_REFRESH_INTERVAL_MS, WIND_RETRY_MS } from '../config';
import {
  D2R,
  fillMissing,
  WIND_FIELD_BLOCKS,
  type WindFieldBlock,
  type WindFieldBlockDef,
} from '../lib/windField';

export interface WindFieldView {
  status: 'idle' | 'loading' | 'error' | 'ready';
  /** Último dato bueno; se conserva ante errores y con el toggle apagado. */
  blocks: WindFieldBlock[] | null;
}

/**
 * Última descarga buena, persistida: encender y apagar el interruptor (o
 * recargar) dentro de la ventana no vuelve a pedir. Caduca pronto: el flujo
 * de hace horas ya no describe la jornada.
 */
const WIND_FIELD_CACHE_KEY = 'fm-windfield-v1';
const WIND_FIELD_CACHE_TTL_MS = 60 * 60 * 1000;

interface CachedField {
  at: number;
  /** u/v por bloque, en el orden de WIND_FIELD_BLOCKS. */
  blocks: Array<{ u: number[]; v: number[] }>;
}

function readFieldCache(): { at: number; blocks: WindFieldBlock[] } | null {
  try {
    const raw = localStorage.getItem(WIND_FIELD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedField;
    if (Date.now() - parsed.at > WIND_FIELD_CACHE_TTL_MS) return null;
    if (!Array.isArray(parsed.blocks) || parsed.blocks.length !== WIND_FIELD_BLOCKS.length) {
      return null;
    }
    const blocks = WIND_FIELD_BLOCKS.map((def, b): WindFieldBlock | null => {
      const entry = parsed.blocks[b];
      const n = def.nx * def.ny;
      if (!Array.isArray(entry?.u) || entry.u.length !== n || entry.v.length !== n) return null;
      return { ...def, u: Float32Array.from(entry.u), v: Float32Array.from(entry.v) };
    });
    return blocks.every(Boolean) ? { at: parsed.at, blocks: blocks as WindFieldBlock[] } : null;
  } catch {
    return null; // localStorage inaccesible o JSON corrupto: como si no hubiera
  }
}

function writeFieldCache(at: number, blocks: WindFieldBlock[]): void {
  try {
    const entry: CachedField = {
      at,
      blocks: blocks.map((g) => ({
        // 1 decimal basta (km/h) y recorta el JSON a ~1/3.
        u: [...g.u].map((x) => Math.round(x * 10) / 10),
        v: [...g.v].map((x) => Math.round(x * 10) / 10),
      })),
    };
    localStorage.setItem(WIND_FIELD_CACHE_KEY, JSON.stringify(entry));
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

/** Una petición GET por bloque; guarda COMPONENTES del vector "hacia donde
 *  sopla" (interpolar ángulos da basura al cruzar el norte, ver lib). */
async function fetchBlock(def: WindFieldBlockDef, signal: AbortSignal): Promise<WindFieldBlock> {
  const lons: number[] = [];
  const lats: number[] = [];
  for (let j = 0; j < def.ny; j++) {
    for (let i = 0; i < def.nx; i++) {
      lons.push(Math.round((def.x0 + i * def.step) * 100) / 100);
      lats.push(Math.round((def.y0 + j * def.step) * 100) / 100);
    }
  }
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lats.join(',')}` +
    `&longitude=${lons.join(',')}` +
    '&current=wind_speed_10m,wind_direction_10m';
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open-Meteo devolvió HTTP ${res.status}.`);
  const body: unknown = await res.json();
  const list = (Array.isArray(body) ? body : [body]) as OpenMeteoEntry[];
  if (list.length !== lats.length) {
    throw new Error('Open-Meteo devolvió un número de ubicaciones inesperado.');
  }

  const n = lats.length;
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const valid: boolean[] = new Array(n).fill(false);
  list.forEach((entry, k) => {
    const c = entry?.current;
    if (!finite(c?.wind_speed_10m) || !finite(c?.wind_direction_10m)) return;
    const dirTo = (c.wind_direction_10m + 180) % 360; // Open-Meteo da la procedencia
    u[k] = c.wind_speed_10m * Math.sin(dirTo * D2R);
    v[k] = c.wind_speed_10m * Math.cos(dirTo * D2R);
    valid[k] = true;
  });
  if (!valid.some(Boolean)) throw new Error('Open-Meteo no devolvió ningún punto válido.');
  fillMissing(u, v, valid, def);
  return { ...def, u, v };
}

/**
 * Campo de flujo de viento sobre toda la cobertura (546 puntos a 0,5°, en dos
 * bloques). Independiente de useWind: las plumas por foco funcionan igual con
 * esta capa apagada.
 *
 * Coste: el peso de Open-Meteo es nLocations × (nDays/14) × (nVariables/10)
 * con mínimo de 14 días — con 2 variables, 0,2 llamadas por punto. Las dos
 * peticiones (486 + 60 puntos) suman 109,2 llamadas ponderadas por refresco,
 * sobre 10.000 diarias por IP del visitante. Defensas: NADA de fetch con la
 * capa apagada (quien no la activa gasta cero), cadencia de 30 min, pausa
 * total con la pestaña oculta y caché en localStorage para que alternar el
 * interruptor no repita la petición. Fallo silencioso: se conserva el último
 * dato bueno; si no hay ninguno, la capa simplemente no pinta.
 */
export function useWindField(enabled: boolean): WindFieldView {
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<WindFieldView>(() => {
    const cached = readFieldCache();
    return cached ? { status: 'ready', blocks: cached.blocks } : { status: 'idle', blocks: null };
  });
  const lastSuccess = useRef<number | null>(
    (() => {
      const cached = readFieldCache();
      return cached ? cached.at : null;
    })()
  );

  useEffect(() => {
    if (!enabled) return; // sin fetch ni timer; el dato cacheado se conserva

    // Pestaña oculta: ni fetch ni timer — no se gasta cupo en background. Al
    // volver a ser visible se re-evalúa, y la ventana de frescura decide.
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

    const freshFor =
      lastSuccess.current !== null
        ? lastSuccess.current + WIND_FIELD_REFRESH_INTERVAL_MS - Date.now()
        : 0;
    if (freshFor > 0) {
      schedule(freshFor);
    } else {
      (async () => {
        try {
          setView((v) => ({ ...v, status: 'loading' }));
          const blocks = await Promise.all(
            WIND_FIELD_BLOCKS.map((def) => fetchBlock(def, controller.signal))
          );
          if (cancelled) return;
          const at = Date.now();
          lastSuccess.current = at;
          writeFieldCache(at, blocks);
          setView({ status: 'ready', blocks });
          schedule(WIND_FIELD_REFRESH_INTERVAL_MS);
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
  }, [enabled, tick]);

  return view;
}
