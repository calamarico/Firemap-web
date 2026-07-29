import { useEffect, useMemo, useState } from 'react';
import logoUrl from '../assets/logo.png';
import {
  buildEmbedUrl,
  EMBED_DEFAULTS,
  EMBED_LAYERS,
  LAYER_KEYS,
  SITE_ORIGIN,
  type EmbedConfig,
  type EmbedLayerKey,
} from '../lib/embed';
import { findLocalityByName, findLocalityBySlug, type LocalityHit } from '../lib/locality';
import type { BasemapId } from '../map/layers';
import type { MapTheme } from '../styles/mapTokens';
import Button from './ui/Button';
import Icon from './ui/Icon';
import LayerToggle from './ui/LayerToggle';
import SegmentedControl from './ui/SegmentedControl';

/**
 * Generador del código de inserción (/insertar): la página que convierte "se
 * puede embeber" en "lo embeben". Un medio entra, elige localidad y capas, ve
 * la previsualización real (un iframe apuntando a /embed) y copia el snippet.
 *
 * Las claves de la URL NO se escriben aquí: salen de buildEmbedUrl (lib/embed),
 * el mismo módulo que las lee al arrancar el widget. Si se duplicaran, el código
 * que copia el periodista podría pintar algo distinto de lo que previsualizó.
 */

const BASEMAP_OPTIONS: ReadonlyArray<{ value: BasemapId; label: string }> = [
  { value: 'satellite', label: 'Satélite' },
  { value: 'dark', label: 'Oscuro' },
  { value: 'light', label: 'Claro' },
];

const THEME_OPTIONS: ReadonlyArray<{ value: MapTheme; label: string }> = [
  { value: 'dark', label: 'Oscuro' },
  { value: 'light', label: 'Claro' },
];

type SizeMode = 'responsive' | 'fixed';
const SIZE_OPTIONS: ReadonlyArray<{ value: SizeMode; label: string }> = [
  { value: 'responsive', label: 'Responsive' },
  { value: 'fixed', label: 'Alto fijo' },
];

const IFRAME_TITLE = 'Mapa de incendios en España y Portugal en tiempo real';

/**
 * Punto de partida del generador: **paneles oscuros sobre mapa base claro**
 * (CARTO Positron). No es lo mismo que los defaults del contrato de la URL
 * (`EMBED_DEFAULTS`, lib/embed.ts, que siguen siendo satélite + oscuro): quien
 * llega aquí es un medio que maqueta en blanco, y ahí un mapa claro se integra
 * en el artículo mientras los paneles oscuros mantienen legible la marca y los
 * datos sobre él. Quien monte la URL a mano sin pasar por esta página sigue
 * obteniendo la casa, y por eso el snippet lleva `base=claro` explícito.
 */
const BUILDER_DEFAULTS: EmbedConfig = { ...EMBED_DEFAULTS, theme: 'dark', basemap: 'light' };

/**
 * Snippet a copiar. Dos formas, y las dos llevan el crédito enlazado debajo:
 * es la condición de uso y, de paso, lo que hace que insertar el mapa nos
 * devuelva algo. Estilos en línea a propósito: tiene que funcionar pegado en un
 * gestor de contenidos que no deja tocar el CSS.
 */
function buildSnippet(src: string, mode: SizeMode, height: number, ratio: number): string {
  const credit =
    `<p style="margin:.5rem 0;font:400 13px/1.4 system-ui,sans-serif">Fuente: ` +
    `<a href="${SITE_ORIGIN}/" target="_blank" rel="noopener">Mapa de incendios en España y Portugal · Firemaps</a></p>`;

  if (mode === 'fixed') {
    return (
      `<iframe src="${src}" title="${IFRAME_TITLE}" width="100%" height="${height}"\n` +
      `  style="border:0;display:block" loading="lazy" allowfullscreen></iframe>\n` +
      credit
    );
  }
  return (
    `<div style="position:relative;width:100%;padding-bottom:${ratio}%">\n` +
    `  <iframe src="${src}" title="${IFRAME_TITLE}" loading="lazy" allowfullscreen\n` +
    `    style="position:absolute;top:0;left:0;width:100%;height:100%;border:0"></iframe>\n` +
    `</div>\n` +
    credit
  );
}

export default function EmbedBuilder() {
  const [config, setConfig] = useState<EmbedConfig>({ ...BUILDER_DEFAULTS });
  const [sizeMode, setSizeMode] = useState<SizeMode>('responsive');
  const [height, setHeight] = useState(520);
  const [query, setQuery] = useState('');
  const [hit, setHit] = useState<LocalityHit | null>(null);
  const [searching, setSearching] = useState(false);
  const [copied, setCopied] = useState(false);

  const ratio = 62; // ~16:10, la proporción que mejor encaja en una columna de artículo

  // Búsqueda de localidad con margen: el meta de municipios son ~575 KB y no
  // hay que descargarlo (ni recorrerlo) en cada tecla.
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setHit(null);
      setSearching(false);
      setConfig((c) => ({ ...c, locality: null }));
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        const found =
          (await findLocalityByName(term)) ?? (await findLocalityBySlug(term.toLowerCase()));
        setHit(found);
        setSearching(false);
        setConfig((c) => ({ ...c, locality: found ? found.slug : null }));
      })();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [query]);

  const src = useMemo(() => buildEmbedUrl(config), [config]);
  // La previsualización apunta al origen actual (así funciona en local y en los
  // previews de rama); el snippet siempre lleva el dominio canónico.
  const previewSrc = useMemo(() => buildEmbedUrl(config, window.location.origin), [config]);
  /**
   * La previsualización va con retardo sobre `previewSrc`: cada cambio de URL
   * recrea el iframe, y eso es una carga completa del widget (documento + focos
   * + estado de EFFIS + teselas). Quien juega con seis interruptores disparaba
   * seis cargas; con este margen, una ráfaga de cambios cuesta una sola. El
   * retardo también quita el parpadeo de recargar a cada clic.
   */
  const [debouncedPreviewSrc, setDebouncedPreviewSrc] = useState(previewSrc);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedPreviewSrc(previewSrc), 700);
    return () => window.clearTimeout(timer);
  }, [previewSrc]);
  const snippet = useMemo(
    () => buildSnippet(src, sizeMode, height, ratio),
    [src, sizeMode, height, ratio]
  );

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
    } catch {
      // Sin permiso de portapapeles (o http sin TLS): se selecciona el texto
      // para que un Ctrl+C manual lo resuelva.
      const pre = document.getElementById('fm-snippet');
      if (!pre) return;
      const range = document.createRange();
      range.selectNodeContents(pre);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };

  const setLayer = (key: EmbedLayerKey, value: boolean) =>
    setConfig((c) => ({ ...c, [LAYER_KEYS[key]]: value }));

  return (
    <div className="min-h-full bg-app text-ink-primary">
      <header className="border-b border-edge">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4">
          <a href="/" className="flex items-center gap-3">
            <img src={logoUrl} alt="Firemaps España" className="h-10 w-10" />
            <span className="font-display text-sm font-bold">Firemaps España</span>
          </a>
          <a
            href="/"
            className="ml-auto inline-flex items-center gap-1.5 text-sm text-[color:var(--fm-text-link)] hover:underline"
          >
            Ir al mapa
            <Icon name="chevron-right" size={14} />
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-5 py-8">
        <section className="space-y-3">
          <h1 className="text-2xl font-bold leading-tight md:text-3xl">
            Inserta el mapa de incendios de España y Portugal en tu web
          </h1>
          <p className="max-w-2xl text-ink-secondary">
            Copia dos líneas de código y tendrás el mapa de incendios activos —focos de calor
            detectados por los satélites de la NASA, área quemada de Copernicus y viento con la
            dirección del humo— dentro de tu artículo o página, actualizándose solo. Es{' '}
            <strong className="font-semibold text-ink-primary">gratis</strong>, sin registro y sin
            clave de API. La única condición es mantener el crédito enlazado que viene en el código.
          </p>
        </section>

        <div className="grid gap-8 lg:grid-cols-[20rem_1fr]">
          {/* ---------- Opciones ---------- */}
          <section className="space-y-6">
            <h2 className="fm-eyebrow">Personaliza el mapa</h2>

            <div className="space-y-1.5">
              <label htmlFor="fm-locality" className="block text-sm text-ink-secondary">
                Centrar en una localidad <span className="text-ink-faint">(opcional)</span>
              </label>
              <input
                id="fm-locality"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Zamora, Ourense, Guarda…"
                autoComplete="off"
                className="min-h-touch w-full rounded-md border border-edge-strong bg-surface-raised px-3
                  text-sm text-ink-primary placeholder:text-ink-faint"
              />
              <p className="text-micro text-ink-muted" role="status">
                {!query.trim()
                  ? 'Vacío: el mapa arranca con toda la península, Baleares y Canarias.'
                  : searching
                    ? 'Buscando…'
                    : hit
                      ? `Centrado en ${hit.name}.`
                      : 'No encontramos esa localidad; revisa el nombre.'}
              </p>
            </div>

            <div className="space-y-3">
              <span className="block text-sm text-ink-secondary">Capas visibles al cargar</span>
              {EMBED_LAYERS.map((layer) => (
                <LayerToggle
                  key={layer.key}
                  label={layer.label}
                  checked={Boolean(config[LAYER_KEYS[layer.key]])}
                  onChange={(value) => setLayer(layer.key, value)}
                  swatch={layer.swatch}
                  description={
                    layer.key === 'flujo'
                      ? 'Animación continua: consume batería y datos, mejor solo si el viento es el tema.'
                      : undefined
                  }
                />
              ))}
              <p className="text-micro text-ink-faint">
                Quien lea el artículo puede encender y apagar capas desde los botones del mapa.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="block text-sm text-ink-secondary">Tema del widget</span>
              {/* El tema NO arrastra al mapa base: son ejes independientes y las
                  cuatro combinaciones se leen bien (la cartografía se adapta al
                  fondo por su cuenta, ver paletteThemeFor). Antes se acoplaban y
                  elegir «Oscuro» te cambiaba el mapa sin haberlo pedido. */}
              <SegmentedControl
                options={THEME_OPTIONS}
                value={config.theme}
                onChange={(theme) => setConfig((c) => ({ ...c, theme }))}
                ariaLabel="Tema del widget"
              />
              <p className="text-micro text-ink-muted">
                Afecta a los paneles, los botones y la leyenda que flotan sobre el mapa; el fondo lo
                eliges abajo.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="block text-sm text-ink-secondary">Mapa base</span>
              <SegmentedControl
                options={BASEMAP_OPTIONS}
                value={config.basemap}
                onChange={(basemap) => setConfig((c) => ({ ...c, basemap }))}
                ariaLabel="Estilo del mapa base"
              />
            </div>

            <div className="space-y-3">
              <span className="block text-sm text-ink-secondary">Interfaz</span>
              <LayerToggle
                label="Botones de capa"
                checked={config.controls}
                onChange={(controls) => setConfig((c) => ({ ...c, controls }))}
              />
              <LayerToggle
                label="Leyenda"
                checked={config.legend}
                onChange={(legend) => setConfig((c) => ({ ...c, legend }))}
              />
              <LayerToggle
                label="Localidades más afectadas"
                checked={config.ranking}
                onChange={(ranking) => setConfig((c) => ({ ...c, ranking }))}
                description="Ranking en un panel lateral; solo aparece si el hueco supera los 768 px de ancho."
              />
            </div>

            <div className="space-y-1.5">
              <span className="block text-sm text-ink-secondary">Tamaño</span>
              <SegmentedControl
                options={SIZE_OPTIONS}
                value={sizeMode}
                onChange={setSizeMode}
                ariaLabel="Forma de dimensionar el mapa"
              />
              {sizeMode === 'fixed' ? (
                <label className="mt-1.5 flex items-center gap-2 text-sm text-ink-secondary">
                  Alto
                  <input
                    type="number"
                    min={280}
                    max={1200}
                    step={20}
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value) || 520)}
                    className="min-h-touch w-24 rounded-md border border-edge-strong bg-surface-raised
                      px-2 text-sm text-ink-primary"
                  />
                  px
                </label>
              ) : (
                <p className="text-micro text-ink-muted">
                  El mapa se adapta al ancho disponible manteniendo la proporción: es lo que mejor
                  funciona en móvil.
                </p>
              )}
            </div>
          </section>

          {/* ---------- Previsualización + código ----------
              min-w-0: sin esto el `min-width: auto` de las celdas de grid deja
              que el <pre> del snippet (líneas largas sin puntos de corte) estire
              la columna y la página entera scrollee en horizontal, en vez de
              scrollear el propio bloque de código. */}
          <section className="min-w-0 space-y-6">
            <div className="space-y-2">
              <h2 className="fm-eyebrow">Previsualización</h2>
              <div
                className="overflow-hidden rounded-lg border border-edge bg-surface-sunken"
                style={{ height: sizeMode === 'fixed' ? `${height}px` : undefined }}
              >
                <div
                  className="relative w-full"
                  style={{
                    paddingBottom: sizeMode === 'responsive' ? `${ratio}%` : undefined,
                    height: sizeMode === 'fixed' ? '100%' : undefined,
                  }}
                >
                  <iframe
                    // key = src: al cambiar una opción el iframe se recrea para
                    // que el widget lea la configuración nueva al arrancar.
                    key={debouncedPreviewSrc}
                    src={debouncedPreviewSrc}
                    title="Previsualización del mapa de incendios embebido"
                    loading="lazy"
                    allowFullScreen
                    className="absolute left-0 top-0 h-full w-full border-0"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h2 className="fm-eyebrow">Código para pegar</h2>
                <Button size="sm" className="ml-auto" onClick={copy}>
                  <Icon name={copied ? 'check' : 'copy'} size={14} />
                  {copied ? 'Copiado' : 'Copiar código'}
                </Button>
              </div>
              <pre
                id="fm-snippet"
                className="overflow-x-auto rounded-lg border border-edge bg-surface-sunken p-3
                  text-micro leading-relaxed text-ink-secondary"
              >
                <code>{snippet}</code>
              </pre>
              <p className="text-micro text-ink-muted">
                Pégalo en un bloque de HTML de tu gestor de contenidos (en WordPress, bloque «HTML
                personalizado»). El atributo <code>loading="lazy"</code> evita que el mapa cargue
                nada hasta que el lector se acerca a él.
              </p>
            </div>
          </section>
        </div>

        {/* ---------- Prosa (misma información que el HTML estático) ---------- */}
        <section className="max-w-3xl space-y-6 border-t border-edge pt-8 text-sm text-ink-secondary">
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-ink-primary">Condiciones de uso</h2>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                Uso libre y gratuito, también en medios con publicidad. Sin límite de visitas ni
                clave de API.
              </li>
              <li>
                Mantén el crédito enlazado que acompaña al código (<em>Fuente: Mapa de incendios en
                España y Portugal · Firemaps</em>), con enlace seguible a{' '}
                <a
                  href={`${SITE_ORIGIN}/`}
                  className="text-[color:var(--fm-text-link)] hover:underline"
                >
                  firemapsspain.online
                </a>
                .
              </li>
              <li>
                No modifiques el mapa para ocultar la marca, la leyenda o las fuentes de los datos:
                las condiciones de NASA FIRMS y Copernicus obligan a citarlas.
              </li>
              <li>
                Los focos son <strong className="font-semibold text-ink-primary">anomalías
                térmicas detectadas por satélite</strong> (pueden ser quemas agrícolas o industria),
                no incendios confirmados por los servicios de emergencia, y el área quemada es una
                estimación cartografiada a posteriori. Si el mapa acompaña una noticia, conviene
                decirlo.
              </li>
              <li>
                El servicio se ofrece tal cual, sin garantía de disponibilidad: depende de
                servicios ajenos (NASA, Copernicus, Open-Meteo) que a veces se caen.
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-bold text-ink-primary">Parámetros de la URL</h2>
            <p>
              El generador de arriba los escribe por ti, pero puedes montar la URL a mano sobre{' '}
              <code>{SITE_ORIGIN}/embed</code>:
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <code>localidad=zamora</code> — centra el mapa en un municipio (acepta el nombre o
                el slug de <code>/incendios/&lt;slug&gt;</code>).
              </li>
              <li>
                <code>centro=41.50,-5.75</code> y <code>zoom=10</code> — encuadre exacto
                (latitud,longitud; zoom entre 5 y 17).
              </li>
              <li>
                <code>capas=focos,quemado,viento,limites</code> — capas encendidas al cargar; la
                que no aparece, apagada. También existe <code>flujo</code> (campo de viento
                animado, apagado por defecto).
              </li>
              <li>
                <code>tema=claro</code> — paneles, botones y leyenda en claro, para webs con fondo
                blanco (y mapa base claro, si no pides otro).
              </li>
              <li>
                <code>base=claro</code> (o <code>satelite</code>, <code>oscuro</code>) — mapa base,
                independiente del tema: las etiquetas, los límites y el humo se adaptan solos al
                fondo que elijas.
              </li>
              <li>
                <code>controles=0</code>, <code>leyenda=0</code>, <code>ranking=1</code> — quitar
                los botones de capa, quitar la leyenda o añadir el ranking de localidades.
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-bold text-ink-primary">Preguntas frecuentes</h2>
            <p>
              <strong className="font-semibold text-ink-primary">
                ¿Cada cuánto se actualiza el mapa embebido?
              </strong>{' '}
              Los focos se refrescan cada 10 minutos mientras la pestaña está a la vista (con la
              pestaña en segundo plano se pausa, para no gastar datos de tu lector).
            </p>
            <p>
              <strong className="font-semibold text-ink-primary">
                ¿Puedo insertarlo en una newsletter o en AMP?
              </strong>{' '}
              En una newsletter no: el correo no ejecuta iframes ni JavaScript; enlaza al mapa. En
              AMP, usa <code>&lt;amp-iframe&gt;</code> con la misma URL.
            </p>
            <p>
              <strong className="font-semibold text-ink-primary">¿Ralentiza mi página?</strong> Con{' '}
              <code>loading="lazy"</code> el mapa no descarga nada hasta que el lector se acerca a
              él, y el widget no carga la interfaz completa de la web: solo el mapa.
            </p>
            <p>
              <strong className="font-semibold text-ink-primary">
                Necesito algo distinto (otra capa, otro idioma, datos en bruto).
              </strong>{' '}
              Escríbenos por{' '}
              <a
                href="https://github.com/calamarico"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[color:var(--fm-text-link)] hover:underline"
              >
                GitHub
              </a>
              .
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-edge px-5 py-6 text-center text-micro text-ink-faint">
        Datos: NASA FIRMS · Copernicus EFFIS · Open-Meteo · Imágenes de Esri ·{' '}
        <a href="/" className="text-ink-muted hover:text-ink-primary">
          Mapa de incendios en España y Portugal
        </a>
      </footer>
    </div>
  );
}
