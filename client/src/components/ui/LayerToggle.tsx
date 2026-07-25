interface LayerToggleProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** Línea de fuente/cobertura bajo la etiqueta. */
  description?: string;
  /** Color de la capa (valor CSS, p. ej. `var(--fm-severity-3)`). */
  swatch?: string;
}

/**
 * Interruptor de capa del mapa. La fila entera es el objetivo táctil
 * (min-height 44 px), no solo el interruptor.
 */
export default function LayerToggle({
  label,
  checked,
  onChange,
  disabled = false,
  description,
  swatch,
}: LayerToggleProps) {
  return (
    <label
      className={`flex min-h-touch items-center justify-between gap-3 text-sm ${
        disabled ? 'cursor-not-allowed opacity-[var(--fm-disabled-opacity)]' : 'cursor-pointer'
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {swatch && (
          <span
            aria-hidden="true"
            className="h-3 w-3 shrink-0 rounded-[var(--fm-radius-xs)]"
            style={{ backgroundColor: swatch }}
          />
        )}
        <span className="min-w-0">
          <span className="block text-ink-secondary">{label}</span>
          {description && <span className="block text-micro text-ink-faint">{description}</span>}
        </span>
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        {/* Pista 40×24 con pulgar de 18 px y recorrido de 16 px. */}
        <span
          className="h-6 w-10 rounded-full bg-edge-strong transition-colors
            duration-[var(--fm-duration-fast)] peer-checked:bg-action peer-focus-visible:shadow-focus
            after:absolute after:left-[3px] after:top-[3px] after:h-[18px] after:w-[18px]
            after:rounded-full after:bg-white after:transition-transform
            after:duration-[var(--fm-duration-fast)] peer-checked:after:translate-x-4"
        />
      </span>
    </label>
  );
}
