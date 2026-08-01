import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEffisStatus } from './useEffisStatus';
import { useFires } from './useFires';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { useRainForecast } from './useRainForecast';
import { useWind } from './useWind';
import { useWindField } from './useWindField';
import { deriveFireWindSites, deriveRainSites } from '../lib/windPoints';
import { setEffisDown } from '../map/effisTileCache';
import type { RainForecastPoint, WindPoint } from '../types';
import type { EffisView } from './useEffisStatus';
import type { FiresView } from './useFires';
import type { WindFieldBlock } from '../lib/windField';

interface FireMapDataOptions {
  /** Cadencia del auto-refresco de focos (la app y el embed usan distinta). */
  refreshMs: number;
  showWind: boolean;
  showWindField: boolean;
  /**
   * Previsión de lluvia sobre incendios grandes. Solo la app completa: en el
   * embed sobra (espacio mínimo) y cada lector pagaría el cupo de su IP.
   */
  withRain?: boolean;
}

export interface FireMapData {
  fires: FiresView;
  effis: EffisView;
  /** Plumas listas para el mapa: ya ancladas a un foco real del cluster. */
  wind: WindPoint[];
  windField: WindFieldBlock[] | null;
  /** Lluvia prevista (72 h) sobre municipios con incendio relevante. */
  rain: RainForecastPoint[];
  /** Se incrementa cuando EFFIS vuelve de una caída (recarga sus teselas). */
  effisRefreshToken: number;
  refresh: () => void;
}

/**
 * Toda la fontanería de datos del mapa (focos, EFFIS, viento y campo de flujo)
 * con sus defensas de cupo, en un único sitio: la comparten la app completa
 * (App.tsx) y el widget embebible (EmbedView.tsx). Vivía dentro de App hasta
 * que apareció el embed; separarla evita el clásico "se arregló en un sitio y
 * no en el otro" justo en la parte donde los errores cuestan cuota.
 */
export function useFireMapData({
  refreshMs,
  showWind,
  showWindField,
  withRain = false,
}: FireMapDataOptions): FireMapData {
  // El campo de flujo ES movimiento: con "reducir movimiento" no queda nada
  // que enseñar, así que no se pide nada. Quien pinta la UI lo consulta con el
  // mismo hook (la preferencia no se pasa como prop: es del sistema, no del
  // estado de la app).
  const reducedMotion = usePrefersReducedMotion();

  const { view: fires, refresh: refreshFires } = useFires(refreshMs);
  const { view: effis, refresh: refreshEffis } = useEffisStatus(refreshMs);

  // Viento junto a los clusters de focos. Cadencia propia: no se engancha al
  // botón "Refrescar ahora" porque Open-Meteo no actualiza su dato más rápido
  // de ~15 min.
  const impact = fires.data?.impact;
  const hotspots = fires.data?.hotspots;
  const fireWindSites = useMemo(
    () => deriveFireWindSites(impact ?? [], hotspots ?? []),
    [impact, hotspots]
  );
  // A Open-Meteo van los puntos de muestreo (centroides estables): el ancla
  // de dibujo puede moverse con cada refresco de focos sin gastar cupo.
  const fireWindPoints = useMemo(() => fireWindSites.map((s) => s.sample), [fireWindSites]);
  // El primer fetch espera a que los focos se resuelvan (dato o error): sin
  // esto cada carga haría DOS llamadas a Open-Meteo, y el cupo diario por IP
  // pondera cada ubicación de la petición como una llamada.
  const windReady = fires.data !== null || fires.status === 'error';
  const wind = useWind(showWind && windReady, fireWindPoints);

  // Campo de flujo ambiental: hook independiente de useWind (las plumas por
  // foco funcionan igual con esta capa apagada) y sin ningún fetch mientras
  // el interruptor esté apagado o el sistema pida reducir movimiento.
  const windField = useWindField(showWindField && !reducedMotion);

  // Lluvia prevista sobre incendios grandes: mismo gate que el viento (el
  // primer fetch espera a los focos) y petición SEPARADA de la de useWind —
  // fusionarlas multiplicaría su coste ×36 por la cadencia de 15 min.
  const rainSites = useMemo(() => (withRain ? deriveRainSites(impact ?? []) : []), [
    withRain,
    impact,
  ]);
  const rain = useRainForecast(withRain && windReady, rainSites);

  // La pluma se dibuja anclada a un foco real del cluster (máx. FRP), no al
  // centroide administrativo: el vértice del cono nace de un círculo de
  // fuego visible. Si la muestra viene de una caché con clusters ya extintos,
  // se queda en su coordenada de muestreo.
  const windForMap = useMemo(() => {
    const anchors = new Map(fireWindSites.map((s) => [s.sample.join(','), s.anchor]));
    return wind.points.map((p) => {
      const anchor = anchors.get(`${p.lon},${p.lat}`);
      return anchor ? { ...p, lon: anchor[0], lat: anchor[1] } : p;
    });
  }, [wind.points, fireWindSites]);

  // El protocolo de teselas necesita saber si EFFIS está caído: con caída
  // confirmada sirve solo la copia local (Cache API) sin lanzar peticiones,
  // que serían invocaciones del Worker condenadas a fallar (y quota del free).
  const effisDown = effis.status === 'error' || effis.data?.available === false;
  useEffect(() => {
    setEffisDown(effisDown);
  }, [effisDown]);

  // EFFIS caído → recuperado: se fuerza la recarga de sus tiles. Sin esto, lo
  // que el mapa pintó durante la caída (la copia local) se quedaría congelado
  // hasta panear a zona virgen, porque MapLibre nunca reintenta tiles ya
  // resueltos.
  const [effisRefreshToken, setEffisRefreshToken] = useState(0);
  const prevEffisAvailable = useRef<boolean | null>(null);
  const effisAvailable = effis.data?.available ?? null;
  useEffect(() => {
    if (effisAvailable === null) return; // aún sin dato: no cuenta como transición
    if (prevEffisAvailable.current === false && effisAvailable) {
      setEffisRefreshToken((t) => t + 1);
    }
    prevEffisAvailable.current = effisAvailable;
  }, [effisAvailable]);

  const refresh = useCallback(() => {
    refreshFires();
    refreshEffis();
  }, [refreshFires, refreshEffis]);

  return {
    fires,
    effis,
    wind: windForMap,
    windField: windField.blocks,
    rain: rain.points,
    effisRefreshToken,
    refresh,
  };
}
