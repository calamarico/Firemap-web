import ToggleChip from './ui/ToggleChip';

/** Estado de las 6 capas del mapa + la reducción de movimiento; lo eleva App. */
export interface LayerControls {
  showFires: boolean;
  onShowFiresChange: (value: boolean) => void;
  showEffis: boolean;
  onShowEffisChange: (value: boolean) => void;
  showBoundaries: boolean;
  onShowBoundariesChange: (value: boolean) => void;
  showWind: boolean;
  onShowWindChange: (value: boolean) => void;
  showWindField: boolean;
  onShowWindFieldChange: (value: boolean) => void;
  showDanger: boolean;
  onShowDangerChange: (value: boolean) => void;
  /** Con "reducir movimiento" el campo de flujo no existe: solo es animación. */
  reducedMotion: boolean;
}

const REDUCED_MOTION_HINT = 'Requiere animación; tu sistema tiene activado «reducir movimiento».';

/**
 * Controles de capa para móvil: flotan sobre el mapa porque dentro de la hoja
 * inferior —que arranca plegada— nadie los encontraba, y menos aún la capa de
 * flujo de viento. En escritorio no se renderizan: allí manda la lista de
 * LayerToggle de la sidebar, que tiene sitio para las descripciones de fuente.
 *
 * El orden replica el de la sidebar: un solo modelo mental. La fila cabe casi
 * entera en un móvil de 390 px y el último chip asoma cortado, que es lo que
 * invita a arrastrarla; el orden está elegido para que lo que se corte sea
 * "Límites", la capa menos interesante.
 */
export default function LayerChips(props: LayerControls) {
  return (
    <div
      role="group"
      aria-label="Capas del mapa"
      // fm-scroll-x: scroll horizontal sin barra visible (index.css).
      className="fm-scroll-x pointer-events-auto flex gap-1.5 overflow-x-auto py-0.5"
    >
      <ToggleChip
        label="Focos"
        ariaLabel="Focos de calor"
        swatch="var(--fm-severity-3)"
        pressed={props.showFires}
        onPressedChange={props.onShowFiresChange}
      />
      <ToggleChip
        label="Quemado"
        ariaLabel="Área quemada"
        swatch="var(--fm-burnt-fill)"
        pressed={props.showEffis}
        onPressedChange={props.onShowEffisChange}
      />
      <ToggleChip
        label="Viento"
        ariaLabel="Viento junto a los incendios"
        swatch="var(--fm-map-smoke-band-1)"
        pressed={props.showWind}
        onPressedChange={props.onShowWindChange}
      />
      <ToggleChip
        label="Flujo"
        ariaLabel="Flujo de viento"
        swatch="var(--fm-map-flow-trail)"
        pressed={props.showWindField}
        onPressedChange={props.onShowWindFieldChange}
        disabledReason={props.reducedMotion ? REDUCED_MOTION_HINT : undefined}
      />
      <ToggleChip
        label="Riesgo"
        ariaLabel="Riesgo de incendio (previsión de hoy)"
        // Clase "Alto" de la leyenda FWI (lib/fwi.ts).
        swatch="#e6ac00"
        pressed={props.showDanger}
        onPressedChange={props.onShowDangerChange}
      />
      <ToggleChip
        label="Límites"
        ariaLabel="Límites administrativos"
        pressed={props.showBoundaries}
        onPressedChange={props.onShowBoundariesChange}
      />
    </div>
  );
}
