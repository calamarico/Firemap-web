import { SEVERITY } from '../styles/mapTokens';
import { SeverityDot } from './ui/Severity';

/** Leyenda de ambas capas; lee la misma escala de severidad que pinta los círculos. */
export default function Legend({ showEffis }: { showEffis: boolean }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="fm-eyebrow mb-1.5">Focos de calor (potencia radiativa)</h3>
        <ul className="space-y-1">
          {SEVERITY.map((step) => (
            <li key={step.level} className="flex items-center gap-2 text-sm">
              <SeverityDot level={step.level} size={14} />
              <span className="fm-tabular text-ink-secondary">{step.range}</span>
              <span className="text-xs text-ink-faint">{step.label}</span>
            </li>
          ))}
        </ul>
      </div>
      {showEffis && (
        <div>
          <h3 className="fm-eyebrow mb-1.5">Área quemada</h3>
          <div className="flex items-center gap-2 text-sm">
            <SeverityDot color="var(--fm-burnt-fill)" shape="square" size={14} className="opacity-75" />
            <span className="text-ink-secondary">Área quemada estimada</span>
          </div>
        </div>
      )}
    </div>
  );
}
