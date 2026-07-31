import { useEffect, useState } from 'react';
import {
  findNearby,
  portugalCapitals,
  type ActiveLocality,
  type LocalityHit,
} from '../lib/locality';
import { PORTUGAL_SLUG } from '../lib/portugal';

interface NearbyLocalitiesProps {
  locality: ActiveLocality | null;
  onSelectLocality: (hit: LocalityHit) => void;
}

type Block =
  | { kind: 'municipality'; region: string; isPortugal: boolean; links: LocalityHit[] }
  | { kind: 'country'; links: LocalityHit[] };

/**
 * Espejo client-side del bloque de enlaces que el server inyecta en
 * /incendios/<slug> (renderNeighbors / renderDistrictNav): React destruye ese
 * HTML al montar, y este componente lo repone en la interfaz — el crawler que
 * renderiza JS ve el mismo contenido que el HTML crudo, y quien navega salta
 * de localidad sin recargar.
 */
export default function NearbyLocalities({ locality, onSelectLocality }: NearbyLocalitiesProps) {
  const [block, setBlock] = useState<Block | null>(null);

  useEffect(() => {
    setBlock(null);
    if (!locality) return;
    let cancelled = false;
    if (locality.kind === 'country') {
      void portugalCapitals().then((links) => {
        if (!cancelled && links.length > 0) setBlock({ kind: 'country', links });
      });
    } else {
      void findNearby(locality.slug).then((data) => {
        if (!cancelled && data && data.neighbors.length > 0) {
          setBlock({
            kind: 'municipality',
            region: data.region,
            isPortugal: data.isPortugal,
            links: data.neighbors,
          });
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [locality]);

  if (!locality || !block) return null;

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>, hit: LocalityHit) => {
    // Teclas modificadoras: que el navegador abra la página real en pestaña
    // nueva; sin ellas, el salto se hace dentro de la app.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelectLocality(hit);
  };

  return (
    <section className="text-sm text-ink-secondary">
      <h2 className="fm-eyebrow mb-1.5">
        {block.kind === 'country'
          ? 'Incendios en Portugal por distrito'
          : `Incendios cerca de ${locality.name} (${block.region})`}
      </h2>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {block.links.map((hit) => (
          <li key={hit.slug}>
            <a
              href={`/incendios/${hit.slug}`}
              onClick={(event) => handleClick(event, hit)}
              className="text-ink-secondary underline-offset-2 hover:text-ink-primary hover:underline"
            >
              {hit.name}
            </a>
          </li>
        ))}
      </ul>
      {block.kind === 'municipality' && block.isPortugal && (
        <p className="mt-2">
          {/* Navegación real: la landing de país llega server-rendered. */}
          <a
            href={`/incendios/${PORTUGAL_SLUG}`}
            className="text-[color:var(--fm-text-link)] underline-offset-2 hover:underline"
          >
            Incendios en Portugal
          </a>
        </p>
      )}
    </section>
  );
}
