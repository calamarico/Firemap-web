import { SEVERITY } from '../styles/mapTokens';
import { SeverityDot } from './ui/Severity';

/** Leyenda de las capas activas; lee la misma escala de severidad que pinta los círculos. */
export default function Legend({ showEffis, showWind }: { showEffis: boolean; showWind: boolean }) {
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
      {showWind && (
        <div>
          <h3 className="fm-eyebrow mb-1.5">Viento</h3>
          <div className="flex items-center gap-2 text-sm">
            {/* Mismo glifo que en el mapa: ráfaga de trazos con punta de flecha. */}
            <svg
              viewBox="0 0 16 16"
              width={14}
              height={14}
              aria-hidden="true"
              className="shrink-0 text-[color:var(--fm-map-wind-fire)]"
            >
              <path d="M8 0.5 5.4 4.5h5.2Z" fill="currentColor" />
              <path
                d="M8 3.5V13M4.5 5.5V12M11.5 7.5V11"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
            <span className="text-ink-secondary">
              Apunta hacia donde sopla · el haz = alcance del humo en ~15 min
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
