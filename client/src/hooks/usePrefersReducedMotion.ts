import { useMemo } from 'react';

/**
 * ¿El sistema ha pedido reducir el movimiento? Lo consultan tanto la UI (para
 * deshabilitar el interruptor del campo de flujo, que ES solo animación) como la
 * fontanería de datos (para no descargar nada de Open-Meteo si no va a haber
 * animación) y el parseo de `?capas=` (un enlace compartido no puede encender el
 * flujo en un sistema que lo ha desactivado).
 *
 * Se lee una vez por montaje, no se escucha el cambio: la preferencia se cambia
 * en los ajustes del sistema, no a mitad de sesión, y reaccionar en caliente
 * implicaría montar y desmontar el lienzo del campo de flujo.
 */
export function usePrefersReducedMotion(): boolean {
  return useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
}
