import { errorResponse, json } from '../_lib/http';
import { ApiError, Env } from '../_lib/types';

/**
 * POST /api/feedback — micro-encuesta de 2 clics de la app (FeedbackCard).
 * Anónimo por diseño: no se guarda IP, UA ni ningún identificador persistente.
 * El único control es un hash IP+día (rate limit) que caduca a medianoche UTC.
 * Sin binding APP_DB responde 503 y el cliente degrada sin romper.
 */

/** Mismo formato de slug que las páginas /incendios/<slug> ([slug].ts). */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Máximo de envíos por IP y día UTC: sobra para un hogar, corta el relleno. */
const MAX_PER_DAY = 3;
/** Salt fijo del hash (antispam, no seguridad: la IP no se almacena nunca). */
const HASH_SALT = 'fm-feedback-2026';

const isAnswer = (v: unknown): v is boolean | null => v === true || v === false || v === null;

async function ipDayHash(ip: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const bytes = new TextEncoder().encode(`${ip}|${day}|${HASH_SALT}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const db = ctx.env.APP_DB;
    if (!db) {
      throw new ApiError(503, 'FEEDBACK_DISABLED', 'El buzón de feedback no está configurado.');
    }

    let body: unknown;
    try {
      body = await ctx.request.json();
    } catch {
      throw new ApiError(400, 'BAD_JSON', 'El cuerpo debe ser JSON.');
    }
    const { useful, wantsAlerts, locality } = (body ?? {}) as Record<string, unknown>;
    if (!isAnswer(useful) || !isAnswer(wantsAlerts)) {
      throw new ApiError(400, 'BAD_ANSWERS', 'useful y wantsAlerts deben ser true, false o null.');
    }
    if (useful === null && wantsAlerts === null) {
      throw new ApiError(400, 'EMPTY', 'Al menos una respuesta es obligatoria.');
    }
    const localitySlug =
      typeof locality === 'string' && SLUG_RE.test(locality) && locality.length <= 80
        ? locality
        : null;

    const hash = await ipDayHash(ctx.request.headers.get('CF-Connecting-IP') ?? 'unknown');
    const { count } = (await db
      .prepare('SELECT COUNT(*) AS count FROM feedback WHERE ip_day_hash = ?')
      .bind(hash)
      .first<{ count: number }>()) ?? { count: 0 };
    if (count >= MAX_PER_DAY) {
      throw new ApiError(429, 'TOO_MANY', 'Demasiados envíos por hoy.');
    }

    await db
      .prepare(
        'INSERT INTO feedback (created_at, useful, wants_alerts, locality, ip_day_hash) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(
        Date.now(),
        useful === null ? null : useful ? 1 : 0,
        wantsAlerts === null ? null : wantsAlerts ? 1 : 0,
        localitySlug,
        hash
      )
      .run();

    return json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
};
