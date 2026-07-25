import { useState } from 'react';
import type { MunicipalityImpact, RegionImpact } from '../types';
import ImpactList from './ImpactList';
import CollapsibleSection from './ui/CollapsibleSection';

interface ImpactPanelProps {
  impact: RegionImpact[];
  onSelectMunicipality: (municipality: MunicipalityImpact) => void;
}

/**
 * Panel flotante de escritorio con el ranking de localidades afectadas.
 * En móvil no se renderiza: la misma lista vive dentro de la hoja inferior
 * (sección de Sidebar), para no apilar dos paneles sobre un mapa pequeño.
 */
export default function ImpactPanel({ impact, onSelectMunicipality }: ImpactPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className="absolute right-2 top-2 z-panel hidden w-80 flex-col overflow-hidden rounded-lg
        bg-surface-panel text-ink-primary shadow-panel backdrop-blur md:flex"
      style={{ maxHeight: 'calc(100vh - 1rem)' }}
    >
      <CollapsibleSection
        open={!collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        title={<span className="truncate font-semibold">Localidades más afectadas</span>}
      >
        <div className="overflow-y-auto border-t border-edge">
          <ImpactList impact={impact} onSelectMunicipality={onSelectMunicipality} />
        </div>
      </CollapsibleSection>
    </aside>
  );
}
