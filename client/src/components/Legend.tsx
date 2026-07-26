import { SEVERITY } from '../styles/mapTokens';
import { SeverityDot } from './ui/Severity';

/** Leyenda de las capas activas; lee la misma escala de severidad que pinta los círculos. */
export default function Legend({
  showEffis,
  showWind,
  showWindField,
}: {
  showEffis: boolean;
  showWind: boolean;
  showWindField: boolean;
}) {
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
          <h3 className="fm-eyebrow mb-1.5">Viento y humo</h3>
          <div className="flex items-center gap-2 text-sm">
            {/* Mini-cono con las bandas de la pluma, como en el mapa. */}
            <svg viewBox="0 0 20 14" width={22} height={16} aria-hidden="true" className="shrink-0">
              <path d="M1 7 L7.5 3.8 A7.3 7.3 0 0 1 7.5 10.2 Z" fill="var(--fm-map-smoke-band-1)" />
              <path
                d="M7.5 3.8 L14 0.6 A14.6 14.6 0 0 1 14 13.4 L7.5 10.2 A7.3 7.3 0 0 0 7.5 3.8 Z"
                fill="var(--fm-map-smoke-band-2)"
              />
              <circle cx="1" cy="7" r="1.6" fill="var(--fm-severity-3)" />
            </svg>
            <span className="text-ink-secondary">
              La pluma se abre hacia donde va el humo · cada banda, 10 min de recorrido
            </span>
          </div>
        </div>
      )}
      {showWindField && (
        <div>
          <h3 className="fm-eyebrow mb-1.5">Flujo de viento</h3>
          <div className="flex items-center gap-2 text-sm">
            <svg viewBox="0 0 20 12" width={22} height={14} aria-hidden="true" className="shrink-0">
              <path
                d="M1 9 C6 9 7 3 13 3 M4 11.5 C9 11.5 11 5.5 18 5.5"
                stroke="var(--fm-map-flow-trail)"
                strokeWidth="1.2"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
            <span className="text-ink-secondary">
              Viento general de la jornada · no es el viento local del incendio
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
