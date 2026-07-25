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
            {/* Misma silueta que el icono del mapa: asta + punta, apuntando arriba. */}
            <svg
              viewBox="0 0 16 16"
              width={14}
              height={14}
              aria-hidden="true"
              className="shrink-0 text-[color:var(--fm-map-wind-fire)]"
            >
              <path
                d="M8 1.5 4.5 7.5h2.3v7h2.4v-7h2.3Z"
                fill="currentColor"
              />
            </svg>
            <span className="text-ink-secondary">Apunta hacia donde sopla · más larga = más viento</span>
          </div>
        </div>
      )}
    </div>
  );
}
