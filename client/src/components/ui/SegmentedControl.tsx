interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  /** Nombre del grupo para lectores de pantalla. */
  ariaLabel: string;
}

/** Grupo de opciones excluyentes (p. ej. el mapa base). */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`min-h-touch flex-1 rounded-md border px-2 text-xs transition-colors
            duration-[var(--fm-duration-fast)] md:min-h-[40px]
            ${
              value === opt.value
                ? 'border-action bg-action-subtle font-semibold text-action-fg'
                : 'border-edge-strong bg-surface-raised text-ink-secondary hover:border-[color:var(--fm-border-interactive)]'
            }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
