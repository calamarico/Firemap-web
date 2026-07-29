import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleSlash,
  CircleX,
  Flame,
  Info,
  Layers,
  LocateFixed,
  Map,
  Minus,
  Play,
  Plus,
  RefreshCw,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';

/** Set de iconos del design system (Lucide); sustituye a los glifos unicode. */
const ICONS = {
  flame: Flame,
  'refresh-cw': RefreshCw,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  layers: Layers,
  map: Map,
  'triangle-alert': TriangleAlert,
  'circle-check': CircleCheck,
  'circle-slash': CircleSlash,
  'circle-x': CircleX,
  info: Info,
  x: X,
  'locate-fixed': LocateFixed,
  plus: Plus,
  minus: Minus,
  play: Play,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  /** Lado en px; los iconos de Lucide son cuadrados. */
  size?: number;
  className?: string;
  /** Sin etiqueta el icono es decorativo y queda oculto a lectores de pantalla. */
  label?: string;
}

export default function Icon({ name, size = 16, className, label }: IconProps) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      size={size}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      strokeWidth={2}
    />
  );
}
