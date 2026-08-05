/**
 * Estado y reglas de la micro-encuesta de feedback (FeedbackCard): una sola
 * vez por navegador, y NUNCA al aterrizar — solo tras engagement real (segunda
 * visita en días distintos, o 90 s de sesión con la pestaña visible). Cerrada
 * sin responder, guarda silencio 45 días. A quien ya votó (incluidos los de
 * antes de existir el texto libre) se le pide UNA vez el comentario opcional;
 * enviado o declinado, silencio definitivo. Todo el estado vive en
 * localStorage: el servidor no conoce al visitante.
 */

export const FEEDBACK_KEY = 'fm-feedback-v1';

/** Segundos de sesión visibles que habilitan la card en la primera visita. */
export const FEEDBACK_SESSION_SECONDS = 90;
/** Tope del texto libre; el endpoint valida el mismo límite. */
export const FEEDBACK_COMMENT_MAX = 500;
const MIN_VISIT_DAYS = 2;
const DISMISS_QUIET_DAYS = 45;
const MAX_TRACKED_DAYS = 10;

/** 'survey': flujo completo (2 votos + comentario). 'comment': solo el texto libre. */
export type FeedbackMode = 'survey' | 'comment';

interface FeedbackState {
  status: 'pending' | 'answered' | 'dismissed';
  at?: number;
  /** Momento en que el comentario quedó zanjado (enviado o declinado). */
  commentAt?: number;
  visitDays: string[];
}

function read(): FeedbackState {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as FeedbackState;
      if (parsed && Array.isArray(parsed.visitDays)) return parsed;
    }
  } catch {
    // localStorage inaccesible o corrupto: estado limpio (y sin persistencia)
  }
  return { status: 'pending', visitDays: [] };
}

function write(state: FeedbackState): void {
  try {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(state));
  } catch {
    // sin persistencia: la card podría reaparecer en otra visita, aceptable
  }
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Registra la visita de hoy (una entrada por día, acotado). */
export function registerVisit(): void {
  const state = read();
  const today = todayUtc();
  if (!state.visitDays.includes(today)) {
    state.visitDays = [...state.visitDays, today].slice(-MAX_TRACKED_DAYS);
    write(state);
  }
}

/**
 * ¿Toca mostrar la card, y en qué modo? (llamar con los segundos de sesión
 * visibles). null = no molestar.
 */
export function shouldShowFeedback(sessionSeconds: number): FeedbackMode | null {
  const state = read();
  const engaged =
    state.visitDays.length >= MIN_VISIT_DAYS || sessionSeconds >= FEEDBACK_SESSION_SECONDS;
  if (!engaged) return null;
  if (state.status === 'answered') {
    // Ya votó: se le pide (una sola vez) el comentario de texto libre.
    return state.commentAt ? null : 'comment';
  }
  if (state.status === 'dismissed') {
    const quietUntil = (state.at ?? 0) + DISMISS_QUIET_DAYS * 86_400_000;
    if (Date.now() < quietUntil) return null;
  }
  return 'survey';
}

export function markDismissed(): void {
  write({ ...read(), status: 'dismissed', at: Date.now() });
}

function markAnswered(): void {
  write({ ...read(), status: 'answered', at: Date.now() });
}

export interface FeedbackAnswers {
  useful: boolean | null;
  wantsAlerts: boolean | null;
}

/**
 * Envía las respuestas y marca el estado como respondido PASE LO QUE PASE:
 * es feedback — si el buzón falla (503 sin D1, red…), no se molesta al
 * usuario ni se le vuelve a preguntar.
 */
export async function submitFeedback(
  answers: FeedbackAnswers,
  localitySlug?: string | null
): Promise<void> {
  markAnswered();
  try {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...answers, locality: localitySlug ?? undefined }),
    });
  } catch {
    // silencioso a propósito
  }
}

/** El comentario queda zanjado (enviado o declinado): no se vuelve a pedir. */
export function markCommentDone(): void {
  write({ ...read(), commentAt: Date.now() });
}

/**
 * Envía el texto libre como fila propia (anónima: sin enlace con los votos) y
 * lo marca zanjado pase lo que pase, con la misma filosofía que submitFeedback.
 */
export async function submitComment(text: string, localitySlug?: string | null): Promise<void> {
  markCommentDone();
  try {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        useful: null,
        wantsAlerts: null,
        comment: text,
        locality: localitySlug ?? undefined,
      }),
    });
  } catch {
    // silencioso a propósito
  }
}
