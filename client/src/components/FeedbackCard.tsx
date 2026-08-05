import { useEffect, useRef, useState } from 'react';
import {
  FEEDBACK_COMMENT_MAX,
  markCommentDone,
  markDismissed,
  submitComment,
  submitFeedback,
  type FeedbackAnswers,
  type FeedbackMode,
} from '../lib/feedback';
import Button from './ui/Button';
import Icon from './ui/Icon';

/**
 * Micro-encuesta flotante y NO modal: dos preguntas de un clic (¿útil? →
 * ¿querrías alertas de proximidad?) más un comentario de texto libre opcional.
 * En modo 'comment' (quien ya votó antes de existir el texto libre) la card va
 * directa al comentario. App solamente — el widget embebido jamás muestra
 * encuestas. Quien la cierra no vuelve a verla en semanas; quien vota y zanja
 * el comentario (enviado o declinado), nunca más (lib/feedback.ts).
 */

interface FeedbackCardProps {
  /** 'survey': flujo completo. 'comment': solo el texto libre. */
  mode: FeedbackMode;
  /** Slug de la localidad activa (contexto anónimo de la respuesta). */
  localitySlug?: string | null;
  /** Aviso al padre para desmontar. */
  onClose: () => void;
}

type Step = 'useful' | 'alerts' | 'comment' | 'thanks';

export default function FeedbackCard({ mode, localitySlug, onClose }: FeedbackCardProps) {
  const [step, setStep] = useState<Step>(mode === 'comment' ? 'comment' : 'useful');
  const [comment, setComment] = useState('');
  const answers = useRef<FeedbackAnswers>({ useful: null, wantsAlerts: null });

  // El "gracias" se despide solo: nadie debería tener que cerrar un gracias.
  useEffect(() => {
    if (step !== 'thanks') return;
    const timer = window.setTimeout(onClose, 2500);
    return () => window.clearTimeout(timer);
  }, [step, onClose]);

  const answerUseful = (value: boolean) => {
    answers.current.useful = value;
    setStep('alerts');
  };

  const answerAlerts = (value: boolean) => {
    answers.current.wantsAlerts = value;
    // Los votos se envían YA (no se arriesgan a perderse si abandona el
    // comentario a medias); el texto libre viajará en un envío aparte.
    void submitFeedback(answers.current, localitySlug);
    setStep('comment');
  };

  const sendComment = () => {
    const text = comment.trim().slice(0, FEEDBACK_COMMENT_MAX);
    if (!text) return;
    void submitComment(text, localitySlug);
    setStep('thanks');
  };

  const dismiss = () => {
    if (step === 'comment') {
      // Los votos (si los hubo) ya están enviados; declinar el comentario lo
      // zanja para siempre.
      markCommentDone();
    } else if (answers.current.useful !== null) {
      // Cerrada a mitad: lo contestado vale oro igual — se envía parcial
      // (submitFeedback marca "answered"; el comentario se pedirá otro día).
      void submitFeedback(answers.current, localitySlug);
    } else {
      markDismissed();
    }
    onClose();
  };

  return (
    <section
      role="region"
      aria-label="Encuesta breve"
      className="pointer-events-auto fixed bottom-20 right-2 z-panel w-[min(320px,calc(100vw-1rem))]
        rounded-lg bg-surface-panel p-3 text-sm text-ink-primary shadow-panel backdrop-blur
        md:bottom-6 md:right-14"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-medium leading-snug">
          {step === 'useful' && '¿Te está resultando útil este mapa?'}
          {step === 'alerts' &&
            '¿Te gustaría poder recibir un aviso si se detecta un incendio cerca de tu zona?'}
          {step === 'comment' &&
            (mode === 'comment'
              ? '¿Echas algo en falta o mejorarías algo en el mapa?'
              : '¡Gracias! Última cosa: ¿echas algo en falta o mejorarías algo?')}
          {step === 'thanks' && '¡Gracias! Nos ayuda a decidir qué construir 🔥'}
        </p>
        {step !== 'thanks' && (
          <button
            onClick={dismiss}
            aria-label="Cerrar la encuesta"
            title="Cerrar"
            className="shrink-0 rounded p-0.5 text-ink-muted hover:text-ink-primary"
          >
            <Icon name="x" size={14} />
          </button>
        )}
      </div>

      {step === 'useful' && (
        <div className="mt-2.5 flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => answerUseful(true)}>
            👍 Sí
          </Button>
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => answerUseful(false)}>
            👎 No
          </Button>
        </div>
      )}
      {step === 'alerts' && (
        <div className="mt-2.5 flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => answerAlerts(true)}>
            Sí
          </Button>
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => answerAlerts(false)}>
            No
          </Button>
        </div>
      )}
      {step === 'comment' && (
        <>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={FEEDBACK_COMMENT_MAX}
            rows={3}
            placeholder="Escríbelo aquí (opcional)…"
            aria-label="Tu comentario"
            className="mt-2.5 w-full resize-none rounded-md border border-edge-strong bg-surface-raised
              p-2 text-sm text-ink-primary placeholder:text-ink-faint"
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={sendComment} disabled={!comment.trim()}>
              Enviar
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
