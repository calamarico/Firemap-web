import { useId } from 'react';
import { SeverityDot } from './Severity';

interface ToggleChipProps {
  /** Texto visible; puede ir abreviado, pero debe estar contenido en `ariaLabel`. */
  label: string;
  pressed: boolean;
  onPressedChange: (value: boolean) => void;
  /** Nombre completo para lectores de pantalla cuando `label` va abreviado. */
  ariaLabel?: string;
  /** Color de la capa (valor CSS, p. ej. `var(--fm-severity-3)`). */
  swatch?: string;
  /** Presente = control inoperante; el texto explica el motivo. */
  disabledReason?: string;
}

/**
 * Píldora pulsable de dos estados, para grupos de opciones NO excluyentes (las
 * capas del mapa). No es `SegmentedControl` —ese es un radiogroup: selección
 * única— ni `SeverityChip`, que no se pulsa; hereda de este la geometría y de
 * aquel los colores de estado.
 *
 * Con `disabledReason` NO se usa el atributo `disabled`: un botón deshabilitado
 * no es enfocable y entonces el motivo no llegaría nunca a un lector de
 * pantalla, que es justo lo que aquí hay que comunicar.
 */
export default function ToggleChip({
  label,
  pressed,
  onPressedChange,
  ariaLabel,
  swatch,
  disabledReason,
}: ToggleChipProps) {
  const hintId = useId();
  const inoperative = Boolean(disabledReason);
  const on = pressed && !inoperative;

  return (
    <>
      <button
        type="button"
        aria-pressed={on}
        aria-label={ariaLabel}
        aria-disabled={inoperative || undefined}
        aria-describedby={inoperative ? hintId : undefined}
        title={disabledReason}
        onClick={() => {
          if (!inoperative) onPressedChange(!pressed);
        }}
        // focus-visible:rounded-full no es decorativo: la regla global de
        // :focus-visible (index.css) impone un radio de 4px que cuadraría la
        // píldora al enfocarla con teclado.
        // El fondo es SIEMPRE opaco (bg-surface-raised): el chip flota sobre la
        // imagen satelital, y el cian translúcido que usa SegmentedControl para
        // el estado activo —que allí se apoya en un panel opaco— dejaría pasar
        // la textura del terreno y se comería la legibilidad del texto. El
        // estado va por borde + color + peso + opacidad del punto.
        className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap
          rounded-full border bg-surface-raised px-2.5 text-xs shadow-control transition-colors
          duration-[var(--fm-duration-fast)] focus-visible:rounded-full
          ${inoperative ? 'cursor-not-allowed opacity-[var(--fm-disabled-opacity)]' : ''}
          ${on ? 'border-action font-semibold text-action-fg' : 'border-edge-strong text-ink-muted'}`}
      >
        {/* SeverityDot y no un div a pelo: trae el borde claro de
            --fm-severity-stroke, imprescindible porque los colores de humo y
            de flujo son translúcidos y sin borde no se verían. */}
        {swatch && <SeverityDot color={swatch} size={10} className={on ? '' : 'opacity-50'} />}
        {label}
      </button>
      {inoperative && (
        <span id={hintId} className="sr-only">
          {disabledReason}
        </span>
      )}
    </>
  );
}
