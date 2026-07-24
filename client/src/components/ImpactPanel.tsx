import { useState } from 'react';
import type { RegionImpact } from '../types';

/**
 * Ranking de localidades más afectadas por focos de calor, agrupado por
 * comunidad autónoma (acordeón). Los datos llegan ya agregados del proxy
 * (join espacial foco→municipio→comunidad hecho en servidor).
 */
export default function ImpactPanel({ impact }: { impact: RegionImpact[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [openRegions, setOpenRegions] = useState<ReadonlySet<string>>(new Set());

  const toggleRegion = (name: string) => {
    setOpenRegions((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <aside
      className="absolute right-2 top-2 z-10 hidden w-80 flex-col overflow-hidden rounded-lg
        bg-slate-950/90 text-slate-100 shadow-2xl backdrop-blur md:flex"
      style={{ maxHeight: 'calc(100vh - 1rem)' }}
    >
      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-900/60"
      >
        <span className="text-sm font-semibold">Localidades más afectadas</span>
        <span className="text-xs text-slate-400">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="overflow-y-auto border-t border-slate-800">
          {impact.length === 0 && (
            <p className="px-4 py-3 text-xs text-slate-400">
              Ninguna localidad con focos dentro ahora mismo.
            </p>
          )}
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
      )}
    </aside>
  );
}
