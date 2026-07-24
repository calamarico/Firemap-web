import { useState } from 'react';
import type { MunicipalityImpact, RegionImpact } from '../types';

interface ImpactListProps {
  impact: RegionImpact[];
  /** Al pulsar una localidad, el mapa vuela a sus focos. */
  onSelectMunicipality: (municipality: MunicipalityImpact) => void;
}

/**
 * Acordeón de localidades afectadas agrupadas por comunidad autónoma.
 * Se usa en dos contenedores: el panel flotante de escritorio (ImpactPanel)
 * y una sección de la hoja inferior en móvil (Sidebar).
 */
export default function ImpactList({ impact, onSelectMunicipality }: ImpactListProps) {
  const [openRegions, setOpenRegions] = useState<ReadonlySet<string>>(new Set());

  const toggleRegion = (name: string) => {
    setOpenRegions((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (impact.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-slate-400">
        Ninguna localidad con focos dentro ahora mismo.
      </p>
    );
  }

  return (
    <div>
      {impact.map((region) => {
        const open = openRegions.has(region.name);
        return (
          <div key={region.name} className="border-b border-slate-800/60 last:border-b-0">
            <button
              onClick={() => toggleRegion(region.name)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left
                text-sm hover:bg-slate-900/60"
            >
              <span className="flex items-center gap-2">
                <span className="w-3 text-xs text-slate-500">{open ? '▾' : '▸'}</span>
                <span className="text-slate-200">{region.name}</span>
              </span>
              <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-xs font-semibold tabular-nums text-orange-300">
                {region.count}
              </span>
            </button>
            {open && (
              <ul className="pb-2">
                {region.municipalities.map((muni) => (
                  <li key={muni.name}>
                    <button
                      onClick={() => onSelectMunicipality(muni)}
                      title={`Ver ${muni.name} en el mapa`}
                      className="flex w-full items-baseline justify-between gap-2 py-1 pl-9 pr-4
                        text-left text-xs hover:bg-slate-900/60"
                    >
                      <span className="truncate text-slate-300 underline-offset-2 hover:underline">
                        {muni.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-400">
                        {muni.count} {muni.count === 1 ? 'foco' : 'focos'}
                        {muni.maxFrp !== null && (
                          <span className="ml-1 text-slate-500">· máx {muni.maxFrp.toFixed(0)} MW</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
