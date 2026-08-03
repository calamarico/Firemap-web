import type { CSSProperties } from 'react';
import type { IncidentState } from '../../types';
import Icon from './Icon';

/**
 * Estado operativo oficial de un incendio (Bombers/JCyL/Copernicus EMS/
 * Fogos.pt). Sistema híbrido del handoff 2026-08-03: solo «activo» grita
 * (píldora magenta — familia SOLO de este rol, fuera de la rampa FRP); el
 * resto es indicador de FORMA + texto, distinguible sin color (daltonismo):
 * ● lleno = activo (dentro de la píldora) · ◐ medio = estabilizado ·
 * ○ anillo = controlado · ○ tenue = extinguido · ◇ rombo = señal EMS.
 * Con state === null (parte sin fase) el llamador NO monta este componente.
 */

type BadgeState = Exclude<IncidentState, null> | 'ems';

/** Los dots son spans con border/background, no SVG: el indicador nunca
 *  depende de la carga de un icono. */
const SHAPES: Record<Exclude<BadgeState, 'activo'>, CSSProperties> = {
  estabilizado: {
    border: '1px solid var(--fm-status-shape)',
    background: 'linear-gradient(90deg, var(--fm-status-shape) 50%, transparent 50%)',
  },
  controlado: { border: '1.5px solid var(--fm-status-shape)' },
  extinguido: { border: '1.5px solid var(--fm-status-resolved-shape)', opacity: 0.6 },
  ems: {
    border: '1.5px solid var(--fm-status-ems-fg)',
    transform: 'rotate(45deg)',
    borderRadius: '1px',
  },
};

interface StatusBadgeProps {
  state: BadgeState;
  /** IGR 0-2 (JCyL) o código de activación EMS (EMSR···). */
  level?: string;
  /** sm = fila del ranking (text-micro) · md = popup/ficha (text-xs). */
  size?: 'sm' | 'md';
}

export default function StatusBadge({ state, level, size = 'sm' }: StatusBadgeProps) {
  const textSize = size === 'md' ? 'text-xs' : 'text-micro';

  if (state === 'activo') {
    return (
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-[7px] py-px
          font-semibold tracking-wide ${textSize}`}
        style={{
          background: 'var(--fm-status-active-bg)',
          color: 'var(--fm-status-active-fg)',
        }}
      >
        <Icon name="flame" size={size === 'md' ? 12 : 11} />
        activo{level ? ` · IGR ${level}` : ''}
      </span>
    );
  }

  const isEms = state === 'ems';
  const label = isEms
    ? `emergencia europea${level ? ` ${level}` : ''}`
    : `${state}${level ? ` · IGR ${level}` : ''}`;
  const tone = isEms ? '' : state === 'extinguido' ? 'text-ink-faint' : 'text-ink-secondary';

  return (
    <span
      className={`inline-flex items-center gap-[5px] whitespace-nowrap ${textSize} ${tone}`}
      style={isEms ? { color: 'var(--fm-status-ems-fg)' } : undefined}
    >
      <span
        aria-hidden="true"
        className={`box-border h-[7px] w-[7px] shrink-0 ${isEms ? '' : 'rounded-full'}`}
        style={SHAPES[state]}
      />
      {label}
    </span>
  );
}
