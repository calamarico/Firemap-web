import { useEffect, useRef, useState } from 'react';
import { markDismissed, submitFeedback, type FeedbackAnswers } from '../lib/feedback';
import Button from './ui/Button';
import Icon from './ui/Icon';

/**
 * Micro-encuesta de 2 clics, flotante y NO modal: dos preguntas encadenadas
 * (¿útil? → ¿querrías alertas de proximidad?) y gracias. La segunda valida la
 * feature de alertas push antes de construirla. App solamente — el widget
 * embebido jamás muestra encuestas. Quien la cierra no vuelve a verla en
 * semanas; quien responde, nunca más (lib/feedback.ts).
 */

interface FeedbackCardProps {
  /** Slug de la localidad activa (contexto anónimo de la respuesta). */
  localitySlug?: string | null;
  /** Aviso al padre para desmontar. */
  onClose: () => void;
}

type Step = 'useful' | 'alerts' | 'thanks';

export default function FeedbackCard({ localitySlug, onClose }: FeedbackCardProps) {
  const [step, setStep] = useState<Step>('useful');
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
    void submitFeedback(answers.current, localitySlug);
    setStep('thanks');
  };

  const dismiss = () => {
    // Cerrada a mitad: si ya contestó algo, vale oro igual — se envía parcial
    // (submitFeedback marca "answered"); si no contestó nada, silencio 45 días.
    if (answers.current.useful !== null) {
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
    </section>
  );
}
