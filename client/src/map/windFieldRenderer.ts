import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  blockBounds,
  blockContaining,
  edgeFade,
  sampleWindField,
  D2R,
  type WindFieldBlock,
} from '../lib/windField';
import { MAP, type MapPalette } from '../styles/mapTokens';

/**
 * Campo de flujo como lienzo 2D propio encima del canvas de MapLibre (y por
 * debajo de controles, popups y paneles): 1.100 segmentos a 60 fps cuestan un
 * orden de magnitud menos que 1.100 símbolos de MapLibre actualizados por
 * frame. pointer-events:none — el mapa sigue recibiendo todos los gestos.
 *
 * El estado de cada partícula vive en lon/lat, pero el avance es en píxeles
 * de pantalla (proyectar → avanzar → desproyectar): mismo ritmo visual a
 * cualquier zoom. Convención asumida: el campo ambienta, no mide.
 */

/** Partículas: la mitad en táctil (cada frame repinta el lienzo entero). */
const PARTICLES_DESKTOP = 1100;
const PARTICLES_COARSE = 550;

/** Vida de una partícula, en píxeles recorridos (aleatoria por partícula). */
const LIFE_MIN_PX = 90;
const LIFE_SPAN_PX = 190;

/** Borrado parcial por frame: la estela queda SIN tapar el mapa de debajo. */
const TRAIL_FADE_ALPHA = 0.075;

/** Una traza a menos de esto del centro de un foco no se dibuja ese frame. */
const FIRE_CLEAR_RADIUS_PX = 14;

/**
 * px por frame. NO lineal a propósito: el viento real en Iberia fuera de un
 * episodio son 4-10 km/h, y un mapeo lineal deja el campo congelado.
 * 5 km/h → 1,4 px · 20 → 2,4 px · 45 → 3,3 px
 */
const stepPx = (kmh: number) => 0.5 + Math.sqrt(Math.max(0, kmh)) * 0.42;

/**
 * Con viento débil los puntos vecinos de la rejilla (~55 km) pueden apuntar
 * casi en círculo (brisas nocturnas de valle): la bilineal de vectores
 * opuestos deja un residuo de ~1 km/h cuya dirección es ruido, y stepPx lo
 * pintaría tan decidido como un flujo real — incluso al revés de la pluma de
 * un foco vecino. Por debajo del suelo la traza no se ve; la opacidad plena
 * se alcanza donde el flujo vuelve a ser señal.
 */
const SPEED_FADE_FLOOR_KMH = 1.5;
const SPEED_FADE_FULL_KMH = 4.5;
const speedFade = (kmh: number) =>
  Math.max(0, Math.min(1, (kmh - SPEED_FADE_FLOOR_KMH) / (SPEED_FADE_FULL_KMH - SPEED_FADE_FLOOR_KMH)));

interface Particle {
  lon: number;
  lat: number;
  /** Píxeles recorridos y vida total; la opacidad sale del cociente. */
  px: number;
  maxPx: number;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** El color de la traza sale del token (mapTokens.flowTrail): aquí solo se
 *  descompone para poder modular el alfa por edad y borde. */
function parseRgba(color: string): Rgba {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(color);
  if (!m) return { r: 226, g: 232, b: 240, a: 0.42 };
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}

export interface WindFieldRenderer {
  /** El campo interpolable (null = sin dato: no se pinta nada). */
  setField(blocks: WindFieldBlock[] | null): void;
  /** Centros de foco activos: las trazas no pasan por encima de ellos. */
  setFires(coords: ReadonlyArray<[number, number]>): void;
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

export function createWindFieldRenderer(
  map: MapLibreMap,
  // La paleta se fija al crear el lienzo: el tema es constante por documento
  // (ver mapTokens.mapPalette). En claro la traza pasa a slate oscuro, que sobre
  // CARTO Positron es lo único que se ve.
  palette: MapPalette = MAP
): WindFieldRenderer {
  const container = map.getContainer();
  const canvas = document.createElement('canvas');
  // Encima del canvas de MapLibre y debajo de sus controles y popups: se
  // inserta ANTES del contenedor de controles y se deja el z-index en auto,
  // de modo que decida el orden del DOM y nada quede por encima de la UI.
  canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  const controls = container.querySelector('.maplibregl-control-container');
  if (controls) container.insertBefore(canvas, controls);
  else container.appendChild(canvas);
  const g = canvas.getContext('2d');

  const trail = parseRgba(palette.flowTrail);
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const particleCount = coarse ? PARTICLES_COARSE : PARTICLES_DESKTOP;
  // En táctil el campo corre con la mitad de partículas sobre una pantalla
  // pequeña y brillante: al pelo de 1 px del escritorio no le queda presencia.
  // Se compensa con trazo más grueso y más alfa, no con más partículas (que es
  // lo que cuesta batería).
  const trailWidth = coarse ? 1.8 : 1;
  const trailAlpha = Math.min(1, trail.a * (coarse ? 1.4 : 1));

  let enabled = false;
  let field: WindFieldBlock[] | null = null;
  let fires: ReadonlyArray<[number, number]> = [];
  let particles: Particle[] = [];
  let frame: number | null = null;
  let w = 0;
  let h = 0;

  const resize = () => {
    const rect = container.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    g?.setTransform(dpr, 0, 0, dpr, 0, 0);
    w = rect.width;
    h = rect.height;
    fireBucketsDirty = true;
  };

  const clear = () => g?.clearRect(0, 0, w, h);

  // ——— Focos: cubos espaciales en píxeles, recalculados solo cuando la
  // cámara o los datos cambian (mientras el mapa está quieto, la proyección
  // de ~cientos de focos es constante; por frame solo se consulta).
  let fireBuckets = new Map<string, Array<{ x: number; y: number }>>();
  let fireBucketsDirty = true;
  const BUCKET_PX = FIRE_CLEAR_RADIUS_PX;

  const rebuildFireBuckets = () => {
    fireBuckets = new Map();
    for (const [lon, lat] of fires) {
      const p = map.project([lon, lat]);
      if (p.x < -50 || p.x > w + 50 || p.y < -50 || p.y > h + 50) continue;
      const key = `${Math.floor(p.x / BUCKET_PX)}:${Math.floor(p.y / BUCKET_PX)}`;
      let list = fireBuckets.get(key);
      if (!list) fireBuckets.set(key, (list = []));
      list.push({ x: p.x, y: p.y });
    }
    fireBucketsDirty = false;
  };

  const nearFire = (x: number, y: number): boolean => {
    const ci = Math.floor(x / BUCKET_PX);
    const cj = Math.floor(y / BUCKET_PX);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const list = fireBuckets.get(`${ci + di}:${cj + dj}`);
        if (!list) continue;
        for (const f of list) {
          const dx = f.x - x;
          const dy = f.y - y;
          if (dx * dx + dy * dy < FIRE_CLEAR_RADIUS_PX * FIRE_CLEAR_RADIUS_PX) return true;
        }
      }
    }
    return false;
  };

  // ——— Aparición: punto aleatorio dentro de (viewport ∩ rejilla), eligiendo
  // bloque en proporción al área visible de cada uno. Fuera de los
  // rectángulos no nacen partículas (§ máscara).
  interface SpawnRect {
    west: number;
    south: number;
    east: number;
    north: number;
    weight: number;
  }
  let spawnRects: SpawnRect[] = [];
  let spawnWeight = 0;

  const rebuildSpawnRects = () => {
    spawnRects = [];
    spawnWeight = 0;
    if (!field) return;
    const b = map.getBounds();
    for (const block of field) {
      const r = blockBounds(block);
      const west = Math.max(r.west, b.getWest());
      const east = Math.min(r.east, b.getEast());
      const south = Math.max(r.south, b.getSouth());
      const north = Math.min(r.north, b.getNorth());
      if (east <= west || north <= south) continue;
      const weight = (east - west) * (north - south);
      spawnRects.push({ west, south, east, north, weight });
      spawnWeight += weight;
    }
  };

  const spawn = (p: Particle): boolean => {
    if (spawnWeight === 0) return false;
    let pick = Math.random() * spawnWeight;
    let rect = spawnRects[0];
    for (const r of spawnRects) {
      pick -= r.weight;
      if (pick <= 0) {
        rect = r;
        break;
      }
    }
    p.lon = rect.west + Math.random() * (rect.east - rect.west);
    p.lat = rect.south + Math.random() * (rect.north - rect.south);
    p.px = 0;
    p.maxPx = LIFE_MIN_PX + Math.random() * LIFE_SPAN_PX;
    return true;
  };

  const resetParticles = () => {
    rebuildSpawnRects();
    particles = [];
    for (let i = 0; i < particleCount; i++) {
      // (0, 0) cae fuera de ambos bloques: si ahora mismo no hay rejilla a la
      // vista, la partícula queda "muerta" y el tick reintenta su aparición
      // cada frame — al panear de vuelta a la cobertura, el campo revive.
      const p: Particle = { lon: 0, lat: 0, px: 0, maxPx: 1 };
      if (spawn(p)) {
        // Edades repartidas: el campo arranca ya poblado, sin oleada inicial.
        p.px = Math.random() * p.maxPx;
      }
      particles.push(p);
    }
  };

  const tick = () => {
    frame = requestAnimationFrame(tick);
    if (!g || !field) return;
    // Durante un gesto no se dibuja: el lienzo se limpia en 'move' y el
    // repintado ya lo paga el propio movimiento del mapa.
    if (map.isMoving()) return;
    if (fireBucketsDirty) rebuildFireBuckets();

    // Estela: borrado parcial de todo el lienzo — deja rastro sin velo opaco.
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = `rgba(0,0,0,${TRAIL_FADE_ALPHA})`;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round';
    g.lineWidth = trailWidth;

    const bounds = map.getBounds();
    const margin = 0.4;

    for (const p of particles) {
      const block = blockContaining(field, p.lon, p.lat);
      if (!block) {
        spawn(p);
        continue;
      }
      const wind = sampleWindField(block, p.lon, p.lat);
      const step = stepPx(wind.speed);
      const from = map.project([p.lon, p.lat]);
      const tx = from.x + step * Math.sin(wind.dirTo * D2R);
      const ty = from.y - step * Math.cos(wind.dirTo * D2R);
      const ll = map.unproject([tx, ty]);
      p.lon = ll.lng;
      p.lat = ll.lat;
      p.px += step;

      // La opacidad máxima es el alfa del token (0,42; +40 % en táctil);
      // sin(π·edad) hace que la traza entre y salga — la reaparición no se ve.
      const age = p.px / p.maxPx;
      const alpha =
        trailAlpha *
        Math.sin(Math.PI * Math.min(1, age)) *
        edgeFade(block, p.lon, p.lat) *
        speedFade(wind.speed);
      if (alpha > 0 && !nearFire(from.x, from.y)) {
        g.strokeStyle = `rgba(${trail.r},${trail.g},${trail.b},${alpha})`;
        g.beginPath();
        g.moveTo(from.x, from.y);
        g.lineTo(tx, ty);
        g.stroke();
      }

      if (
        p.px > p.maxPx ||
        p.lon < bounds.getWest() - margin ||
        p.lon > bounds.getEast() + margin ||
        p.lat < bounds.getSouth() - margin ||
        p.lat > bounds.getNorth() + margin
      ) {
        spawn(p);
      }
    }
  };

  const start = () => {
    if (frame !== null || !enabled || !field) return;
    resetParticles();
    frame = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    clear();
  };

  const onMove = () => {
    // Sin esto las estelas se embadurnan al arrastrar el mapa.
    clear();
    fireBucketsDirty = true;
  };
  const onMoveEnd = () => {
    rebuildSpawnRects();
    fireBucketsDirty = true;
  };

  resize();
  map.on('resize', resize);
  map.on('move', onMove);
  map.on('moveend', onMoveEnd);

  return {
    setField(blocks) {
      field = blocks;
      if (!blocks) {
        stop();
        return;
      }
      if (frame === null) start();
      else rebuildSpawnRects();
    },
    setFires(coords) {
      fires = coords;
      fireBucketsDirty = true;
    },
    setEnabled(value) {
      enabled = value;
      if (value) start();
      else stop();
    },
    destroy() {
      stop();
      map.off('resize', resize);
      map.off('move', onMove);
      map.off('moveend', onMoveEnd);
      canvas.remove();
    },
  };
}
