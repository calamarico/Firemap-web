import { Env } from '../_lib/types';

/**
 * El asset server de Cloudflare Pages no soporta peticiones HTTP Range, y el
 * cliente PMTiles vive de ellas ("Check that your storage backend supports
 * HTTP Byte Serving"). Esta Function intercepta SOLO los .pmtiles, carga el
 * archivo completo una vez por isolate (12,5 MB entre los dos: holgado en los
 * 128 MB de Workers) y emula el byte serving devolviendo 206 con las
 * cabeceras correctas. El resto de /data/* sigue su camino normal (next()).
 *
 * Alternativa más elegante si algún día crece el volumen: mover los .pmtiles
 * a R2 (soporta Range nativo) y servirlos con un binding.
 */

const RANGE_SERVED = new Set(['municipios.pmtiles', 'municipios-labels.pmtiles']);

const filePromises = new Map<string, Promise<ArrayBuffer>>();

function loadAsset(env: Env, name: string): Promise<ArrayBuffer> {
  let promise = filePromises.get(name);
  if (!promise) {
    promise = env.ASSETS.fetch(`https://assets.internal/data/${name}`).then(async (res) => {
      if (!res.ok) throw new Error(`Asset ${name}: HTTP ${res.status}`);
      return res.arrayBuffer();
    });
    // Si la carga falla, se olvida la promesa para reintentar en la siguiente.
    promise.catch(() => filePromises.delete(name));
    filePromises.set(name, promise);
  }
  return promise;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const name = url.pathname.replace(/^\/data\//, '');
  if (!RANGE_SERVED.has(name)) return ctx.next();

  const buf = await loadAsset(ctx.env, name);
  const total = buf.byteLength;
  const common: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'public, max-age=86400',
  };

  const rangeHeader = ctx.request.headers.get('Range');
  if (!rangeHeader) {
    return new Response(buf, { headers: { ...common, 'Content-Length': String(total) } });
  }

  // Solo rangos simples ("bytes=a-b", "bytes=a-", "bytes=-n"): es lo único
  // que emite el cliente PMTiles.
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    return new Response('Rango no soportado', {
      status: 416,
      headers: { 'Content-Range': `bytes */${total}` },
    });
  }

  let start: number;
  let end: number;
  if (match[1] === '') {
    // Sufijo: últimos N bytes.
    start = Math.max(0, total - Number(match[2]));
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? total - 1 : Math.min(Number(match[2]), total - 1);
  }
  if (start > end || start >= total) {
    return new Response('Rango fuera de límites', {
      status: 416,
      headers: { 'Content-Range': `bytes */${total}` },
    });
  }

  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      ...common,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${total}`,
    },
  });
};
