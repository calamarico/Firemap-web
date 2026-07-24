import { EFFIS_SWATCH_COLOR, FRP_SCALE } from '../config';

/** Leyenda de ambas capas; usa la misma escala FRP que pinta los círculos. */
export default function Legend({ showEffis }: { showEffis: boolean }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Focos de calor (potencia radiativa)
        </h3>
        <ul className="space-y-1">
          {FRP_SCALE.map((step) => (
            <li key={step.label} className="flex items-center gap-2 text-sm">
              <span
                className="inline-block h-3.5 w-3.5 rounded-full border border-white/40"
                style={{ backgroundColor: step.color }}
              />
              <span className="text-slate-300">{step.label}</span>
            </li>
          ))}
        </ul>
      </div>
      {showEffis && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Área quemada
          </h3>
          <div className="flex items-center gap-2 text-sm">
            <span
              className="inline-block h-3.5 w-3.5 rounded-sm border border-white/40 opacity-75"
              style={{ backgroundColor: EFFIS_SWATCH_COLOR }}
            />
            <span className="text-slate-300">Área quemada estimada</span>
          </div>
        </div>
      )}
    </div>
  );
}
