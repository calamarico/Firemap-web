// Formateo de fechas compartido entre el ranking de localidades (ImpactList)
// y el popup de foco (FirePopup): mismo dato, misma frase en ambos sitios.

/** "hace 5 min", "hace 3 h", "hace 2 días": edad de una detección. */
export function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

/**
 * Día de la lluvia prevista: "hoy", "mañana" o "el sábado". La fecha viene en
 * UTC de Open-Meteo; a escala de día la diferencia con la hora peninsular no
 * cambia el mensaje.
 */
export function formatRainDay(isoDate: string): string {
  const target = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(target.getTime())) return '';
  const today = new Date();
  const diffDays = Math.round(
    (Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate()) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      86_400_000
  );
  if (diffDays <= 0) return 'hoy';
  if (diffDays === 1) return 'mañana';
  return `el ${target.toLocaleDateString('es-ES', { weekday: 'long' })}`;
}
