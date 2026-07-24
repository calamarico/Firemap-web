import { useState } from 'react';
import type { RegionImpact } from '../types';

/**
 * Acordeón de localidades afectadas agrupadas por comunidad autónoma.
 * Se usa en dos contenedores: el panel flotante de escritorio (ImpactPanel)
 * y una sección de la hoja inferior en móvil (Sidebar).
 */
export default function ImpactList({ impact }: { impact: RegionImpact[] }) {
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
                  <li
                    key={muni.name}
                    className="flex items-baseline justify-between gap-2 py-1 pl-9 pr-4 text-xs"
                  >
                    <span className="truncate text-slate-300" title={muni.name}>
                      {muni.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-400">
                      {muni.count} {muni.count === 1 ? 'foco' : 'focos'}
                      {muni.maxFrp !== null && (
                        <span className="ml-1 text-slate-500">· máx {muni.maxFrp.toFixed(0)} MW</span>
                      )}
                    </span>
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
