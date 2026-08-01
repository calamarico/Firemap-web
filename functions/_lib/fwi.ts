/**
 * Riesgo de incendio puntual (Fire Weather Index de Copernicus EFFIS/GWIS).
 *
 * El WMS no expone GetFeatureInfo con valores (verificado: responde features
 * vacías), así que el dato puntual se obtiene pidiendo un GetMap minúsculo
 * (8×8 px, ±0.5°) de la capa `ecmwf.fwi` y leyendo el color del píxel central
 * — el estilo por defecto pinta las 6 clases con colores fijos. WIDTH=1
 * devuelve transparente (quirk de remuestreo de MapServer): de ahi el 8×8.
 *
 * Cacheado en la Cache API por celda de 0.1° y día UTC: los ~8.500 municipios
 * colapsan en pocas celdas de ~8 km (la resolución real del modelo ECMWF) y
 * la capa solo cambia una vez al día.
 */

const GWIS_WMS = 'https://maps.effis.emergency.copernicus.eu/gwis';
const FWI_LAYER = 'ecmwf.fwi';
/** Clave sintética de Cache API (el host es irrelevante: espacio de nombres). */
const CACHE_PREFIX = 'https://firemap.cache/api/fwi-v1';

export interface FwiClass {
  /** Identificador estable ('low' … 'very-extreme'). */
  id: string;
  /** Etiqueta en castellano para UI y páginas de localidad. */
  label: string;
  /** Color de la leyenda EFFIS (para pintar el dato en la UI). */
  color: string;
}

/** Clases y colores del estilo `default` de ecmwf.fwi (leyenda verificada). */
const FWI_CLASSES: Array<FwiClass & { rgb: [number, number, number] }> = [
  { id: 'low', label: 'bajo', color: '#9cffc0', rgb: [156, 255, 192] },
  { id: 'moderate', label: 'moderado', color: '#cde24e', rgb: [205, 226, 78] },
  { id: 'high', label: 'alto', color: '#e6ac00', rgb: [230, 172, 0] },
  { id: 'very-high', label: 'muy alto', color: '#d97010', rgb: [217, 112, 16] },
  { id: 'extreme', label: 'extremo', color: '#ad060e', rgb: [173, 6, 14] },
  { id: 'very-extreme', label: 'muy extremo', color: '#3a0015', rgb: [58, 0, 21] },
];

/** Día UTC actual como 'YYYY-MM-DD' (la capa D0 se publica por día UTC). */
export function fwiDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Segundos hasta la próxima medianoche UTC (TTL de la caché diaria). */
function secondsToUtcMidnight(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.floor((next - now.getTime()) / 1000));
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Des-filtrado PNG (filtros 0-4 por scanline). Solo se procesan imágenes
 * diminutas (8×8), así que la claridad gana a cualquier optimización.
 */
function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const prevRow = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const row = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prevRow ? prevRow[i] : 0;
      const c = i >= bpp && prevRow ? prevRow[i - bpp] : 0;
      let x = raw[pos + i];
      if (filter === 1) x += a;
      else if (filter === 2) x += b;
      else if (filter === 3) x += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        x += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = x & 0xff;
    }
    pos += stride;
  }
  return out;
}

/** RGBA del píxel central de un PNG de 8 bits (colorType 6 RGBA o 2 RGB).
 *  Exportado: la sonda de la capa de riesgo (effis.ts) lo reutiliza para
 *  distinguir "capa viva" de su modo sin-datos (PNG 100 % transparente). */
export async function centerPixel(png: Uint8Array): Promise<[number, number, number, number] | null> {
  // Firma PNG
  if (png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
    const dataStart = offset + 8;
    if (type === 'IHDR') {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      const bitDepth = png[dataStart + 8];
      colorType = png[dataStart + 9];
      if (bitDepth !== 8) return null; // fuera de lo que emite MapServer aquí
    } else if (type === 'IDAT') {
      idat.push(png.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + length + 4; // + CRC
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bpp || !width || !height || idat.length === 0) return null;

  const compressed = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of idat) {
    compressed.set(chunk, at);
    at += chunk.length;
  }
  const pixels = unfilter(await inflate(compressed), width, height, bpp);
  const x = Math.floor(width / 2);
  const y = Math.floor(height / 2);
  const p = (y * width + x) * bpp;
  return [pixels[p], pixels[p + 1], pixels[p + 2], bpp === 4 ? pixels[p + 3] : 255];
}

/** Clase más cercana al color del píxel (el antialiasing entre clases vecinas
 *  cae del lado correcto con distancia euclídea). */
function classifyColor(r: number, g: number, b: number): FwiClass | null {
  let best: FwiClass | null = null;
  let bestDist = Infinity;
  for (const cls of FWI_CLASSES) {
    const [cr, cg, cb] = cls.rgb;
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = cls;
    }
  }
  // Un píxel muy alejado de toda clase no es dato (fondo, borde del mapa…).
  return bestDist <= 90 * 90 * 3 ? best : null;
}

export interface FwiResult {
  id: string;
  label: string;
  color: string;
  date: string;
}

/**
 * Riesgo FWI en un punto, hoy (D0). Devuelve null sin dato (fuera de
 * cobertura, GWIS caído, píxel transparente): quien llama omite el dato,
 * nunca rompe. Mejor esfuerzo con caché diaria por celda de 0.1°.
 */
export async function fetchFwiClass(lat: number, lon: number): Promise<FwiResult | null> {
  const cellLat = Math.round(lat * 10) / 10;
  const cellLon = Math.round(lon * 10) / 10;
  const date = fwiDate();
  const cacheKey = `${CACHE_PREFIX}?cell=${cellLon},${cellLat}&date=${date}`;

  try {
    const hit = await caches.default.match(cacheKey);
    if (hit) {
      const cached = (await hit.json()) as FwiResult | { id: null };
      return cached.id === null ? null : (cached as FwiResult);
    }
  } catch {
    // Cache API es mejor-esfuerzo
  }

  let result: FwiResult | null = null;
  try {
    const bbox = `${cellLon - 0.5},${cellLat - 0.5},${cellLon + 0.5},${cellLat + 0.5}`;
    const url =
      `${GWIS_WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${FWI_LAYER}&STYLES=` +
      `&FORMAT=image%2Fpng&TRANSPARENT=TRUE&SRS=EPSG%3A4326&BBOX=${bbox}` +
      `&WIDTH=8&HEIGHT=8&TIME=${date}`;
    // Timeout corto: esto corre en el camino de las páginas de localidad, y
    // ante un GWIS lento es mejor una página sin la frase que una página lenta.
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')) {
      const pixel = await centerPixel(new Uint8Array(await res.arrayBuffer()));
      if (pixel && pixel[3] >= 128) {
        const cls = classifyColor(pixel[0], pixel[1], pixel[2]);
        if (cls) result = { id: cls.id, label: cls.label, color: cls.color, date };
      }
    }
  } catch {
    return null; // GWIS caído o lento: sin dato y SIN cachear el fallo
  }

  try {
    // También se cachea el "sin dato" (píxel transparente = fuera de dato del
    // modelo): reintentar cada visita sería castigar a GWIS sin beneficio.
    await caches.default.put(
      cacheKey,
      new Response(JSON.stringify(result ?? { id: null }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${secondsToUtcMidnight()}`,
        },
      })
    );
  } catch {
    // sin caché: la siguiente petición repite el GetMap, aceptable
  }
  return result;
}
