import { useState } from 'react';
import Icon from './ui/Icon';

/**
 * Vídeos de presentación del mapa, embebidos con fachada: al cargar solo se
 * pide la miniatura a i.ytimg.com; el iframe (y con él todo el JS de YouTube)
 * no entra hasta que se pulsa. Que sean reproducibles aquí y no meros enlaces
 * es lo que justifica el marcado VideoObject de client/index.html — Google solo
 * da resultados enriquecidos de vídeo si el vídeo está en la página.
 *
 * IMPORTANTE: los ids, títulos y duraciones deben coincidir con el bloque
 * <script id="ld-video"> de client/index.html (los datos estructurados no
 * pueden describir algo distinto de lo que se ve).
 */

interface Video {
  id: string;
  /** Etiqueta corta del botón; el título completo va en el aria-label. */
  label: string;
  title: string;
  /** Vertical (short): el reproductor abierto necesita otra caja. */
  vertical?: boolean;
}

const VIDEOS: readonly Video[] = [
  {
    id: '4XMQa6ULVeA',
    label: 'El mapa en 18 s',
    title: 'Firemaps Spain — Mapa de incendios de España y Portugal',
  },
  {
    id: '2lmSNd2Yztk',
    label: 'Short',
    title: 'Firemaps Spain — Mapa de incendios forestales en España y Portugal',
    vertical: true,
  },
];

export default function VideoPromo() {
  const [playing, setPlaying] = useState<Video | null>(null);

  if (playing) {
    return (
      <div className="space-y-1.5">
        <div
          className={
            'overflow-hidden rounded-lg border border-edge-subtle bg-surface-sunken ' +
            (playing.vertical ? 'mx-auto aspect-[9/16] w-[180px]' : 'aspect-video w-full')
          }
        >
          <iframe
            // youtube-nocookie: sin cookies de seguimiento hasta que se reproduce.
            src={`https://www.youtube-nocookie.com/embed/${playing.id}?autoplay=1&rel=0`}
            title={playing.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="h-full w-full border-0"
          />
        </div>
        <button
          type="button"
          onClick={() => setPlaying(null)}
          className="text-xs text-ink-muted underline-offset-2 hover:text-ink-primary hover:underline"
        >
          Cerrar vídeo
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      {VIDEOS.map((video) => (
        <button
          key={video.id}
          type="button"
          onClick={() => setPlaying(video)}
          aria-label={`Reproducir: ${video.title}`}
          className={
            'group relative h-[124px] overflow-hidden rounded-lg border border-edge-subtle ' +
            'transition-colors hover:border-action ' +
            (video.vertical ? 'w-[70px] shrink-0' : 'flex-1')
          }
        >
          <img
            src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
          {/* Velo + play: la miniatura sola no se lee como reproducible. */}
          <span className="absolute inset-0 flex items-center justify-center bg-app/40 transition-colors group-hover:bg-app/20">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-action text-[color:var(--fm-text-on-accent)]">
              <Icon name="play" size={14} />
            </span>
          </span>
          <span className="absolute inset-x-0 bottom-0 truncate bg-app/70 px-1.5 py-1 text-micro text-ink-secondary">
            {video.label}
          </span>
        </button>
      ))}
    </div>
  );
}
