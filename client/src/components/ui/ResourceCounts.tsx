import Icon, { type IconName } from './Icon';

/**
 * Medios desplegados en un incendio como micro-iconos + cifra — es lo que hace
 * caber «114 operativos · 38 vehículos · 4 medios aéreos» en una fila de
 * 320 px. El texto completo (con unidades y singulares correctos) va en
 * aria-label y title del conjunto: los lectores de pantalla lo leen como una
 * frase. Sin ningún recurso numérico (p. ej. JCyL, que publica los medios como
 * texto libre) no se renderiza nada — ese caso lo cubre el title de la fila.
 */

const RESOURCE_ICONS: Array<[key: 'personnel' | 'vehicles' | 'aerial', icon: IconName, plural: string, singular: string]> = [
  ['personnel', 'users', 'operativos', 'operativo'],
  ['vehicles', 'truck', 'vehículos', 'vehículo'],
  ['aerial', 'plane', 'medios aéreos', 'medio aéreo'],
];

interface ResourceCountsProps {
  personnel?: number;
  vehicles?: number;
  aerial?: number;
  /** sm = fila del ranking · md = popup/ficha. */
  size?: 'sm' | 'md';
}

export default function ResourceCounts({ personnel, vehicles, aerial, size = 'sm' }: ResourceCountsProps) {
  const values = { personnel, vehicles, aerial };
  const parts = RESOURCE_ICONS.filter(([key]) => values[key]);
  if (parts.length === 0) return null;

  const labelText = parts
    .map(([key, , plural, singular]) => `${values[key]} ${values[key] === 1 ? singular : plural}`)
    .join(', ');

  return (
    <span
      role="img"
      aria-label={labelText}
      title={labelText}
      className={`fm-tabular inline-flex items-center gap-2 text-ink-muted ${
        size === 'md' ? 'text-xs' : 'text-micro'
      }`}
    >
      {parts.map(([key, icon]) => (
        <span key={key} className="inline-flex items-center gap-[3px]">
          <Icon name={icon} size={size === 'md' ? 12 : 11} />
          {values[key]}
        </span>
      ))}
    </span>
  );
}
