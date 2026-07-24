import { useState } from 'react';
import type { RegionImpact } from '../types';
import ImpactList from './ImpactList';

/**
 * Panel flotante de escritorio con el ranking de localidades afectadas.
 * En móvil no se renderiza: la misma lista vive dentro de la hoja inferior
 * (sección de Sidebar), para no apilar dos paneles sobre un mapa pequeño.
 */
export default function ImpactPanel({ impact }: { impact: RegionImpact[] }) {
  const [collapsed, setCollapsed] = useState(false);

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
          <ImpactList impact={impact} />
        </div>
      )}
    </aside>
  );
}
