# 🔥 Radar de Incendios · España y Portugal

Aplicación web centrada en el **momento actual**: muestra en un mapa los
**focos de calor** detectados por satélite en las **últimas 24 horas**
(NASA FIRMS, unión de los tres satélites VIIRS —S-NPP, NOAA-20 y NOAA-21— más
MODIS/Terra-Aqua, que cubre el hueco de la tarde-noche) y
los **perímetros de área quemada** recientes (EFFIS / Copernicus) en España
(península, Baleares, Canarias, Ceuta y Melilla) y Portugal continental
(Madeira y Azores quedan fuera). No hay vistas históricas: una sola vista,
siempre al día.

FIRMS solo admite un rectángulo por petición, así que el proxy consulta dos
áreas en paralelo y fusiona los resultados (la lista vive en
`server/src/firms.ts`). Los focos de países vecinos que entran en esos
rectángulos se descartan con un point-in-polygon contra el contorno real de
la cobertura (`server/src/geo.ts` + `server/src/data/coverage-boundary.json`,
generado por `scripts/build-coverage-boundary.mjs` desde geoBoundaries ADM0 de
España y Portugal con ~2 km de margen costero para no perder detecciones
pegadas a la costa).

- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS + MapLibre GL JS.
  Dos mapas base sin API key, conmutables desde el panel: imagen satelital
  (Esri World Imagery, al estilo del visor de FIRMS) y oscuro (CARTO Dark
  Matter `dark_nolabels`). Las etiquetas las pinta la app en castellano como
  capas de símbolos propias —los rasters de CARTO traen topónimos
  anglificados horneados—: nombres de las comunidades autónomas y distritos
  portugueses (`client/public/data/ccaa-labels.json`, centroides
  precalculados) y capitales/ciudades grandes
  (`client/public/data/cities.json`), con los límites administrativos
  escalonados por zoom: comunidades autónomas y distritos (`ccaa.json`),
  provincias desde zoom 6.5 (`provincias.json`) y los 8.483
  municipios/concelhos desde zoom 7 en **teselas vectoriales PMTiles**
  (`municipios.pmtiles` + `municipios-labels.pmtiles`): el navegador pide por
  HTTP Range solo las teselas del viewport, con detalle adaptado al zoom.
  Fuentes: geoBoundaries (España) y CAOP vía `scripts/merge-portugal.mjs`
  (Portugal).
- **Ranking de localidades afectadas**: el proxy hace el join espacial
  foco→municipio→comunidad (polígonos en `server/data/`) y el cliente pinta el
  panel derecho plegable por comunidad autónoma sin cargar ni un polígono.
- **Backend**: proxy Express + TypeScript que oculta el `MAP_KEY` de FIRMS,
  parsea el CSV a JSON (papaparse), cachea con stale-while-revalidate y resuelve CORS.

> ⚠️ Los puntos FIRMS son **anomalías térmicas detectadas por satélite**
> (posibles incendios, pero también quemas agrícolas o industria), **no**
> incendios oficialmente confirmados. Los perímetros EFFIS son **área quemada
> estimada**, cartografiada a posteriori y con posible retraso.

## 1. Obtener el MAP_KEY gratuito de FIRMS

1. Entra en <https://firms.modaps.eosdis.nasa.gov/api/map_key/>.
2. Introduce tu email y envía el formulario; recibirás la clave al instante.
3. La clave permite **5000 transacciones por ventana deslizante de 10 minutos**
   (el consumo se consulta en
   `https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=<clave>`).
   Cada ronda del proxy son 8 peticiones (4 sensores × 2 áreas; hasta 16 con
   los hedges) ≈ 64 transacciones, y se renueva como mucho cada ~5 min:
   lejísimos del límite.

## 2. Configurar el entorno

```bash
cp server/.env.example server/.env
# edita server/.env y pega tu clave:
# FIRMS_MAP_KEY=tu_clave_aqui
```

El `MAP_KEY` **solo** lo lee el proxy: nunca viaja al navegador ni entra en el
bundle del frontend. `.env` está en `.gitignore`.

Sin clave, la app arranca igualmente y muestra un error claro y accionable en
el panel lateral.

## 3. Arrancar en desarrollo

```bash
npm install       # instala raíz + client + server (npm workspaces)
npm run dev       # un solo comando: levanta proxy (:3001) y Vite (:5173)
```

Abre <http://localhost:5173>. `npm run dev` usa `concurrently` para arrancar
los dos procesos; el dev-server de Vite proxea `/api` hacia Express, así que el
frontend siempre habla con el mismo origen.

## 4. Build de producción

```bash
npm run build     # compila server (tsc → server/dist) y client (vite → client/dist)
npm start         # node server/dist/index.js
```

En producción el propio proxy sirve el build estático del cliente, de modo que
todo corre en un único proceso y puerto (<http://localhost:3001>).

## Despliegue en Cloudflare (free plan)

El repo incluye un port completo del proxy a **Cloudflare Pages Functions**
(directorio `functions/`, mismo contrato de API). En Cloudflare no corre
Express: los estáticos los sirve Pages y los tres endpoints los sirven
Functions. Adaptaciones clave para el free plan (10 ms CPU/invocación):

- CSV de FIRMS parseado a mano (sin papaparse) y **ranking de localidades por
  índice de rejilla** precalculado (`scripts/build-muni-index.mjs` →
  `client/public/data/muni-grid.bin` + `muni-meta.json`): lookup O(1) por foco
  en lugar de ray-casting contra 8.205 polígonos. Precisión: celdas de ~1,8 km
  (focos a <2 km de un límite municipal pueden asignarse al vecino).
- Cache en **tres niveles**: variable de módulo (por isolate) + Cache API (por
  datacenter) para isolates fríos + **Workers KV** (global, binding `FIRES_KV`)
  para datacenters fríos. La escritura en KV lleva una guarda de 4 min —techo
  ~360 escrituras/día de las 1000 del free plan— y es mejor-esfuerzo: sin el
  binding, la app funciona igual con las dos primeras capas.

Pasos:

1. Push de este repo a GitHub.
2. Dashboard de Cloudflare → Workers & Pages → Create → Pages →
   conectar el repo. Build command: `npm run build:cf` · Build output:
   `client/dist` (ya declarado en `wrangler.toml`).
3. Settings → Environment variables → añade `FIRMS_MAP_KEY` (Production y
   Preview).
4. KV para la cache global: `wrangler kv namespace create FIRES_KV` y pega el
   `id` resultante en el bloque `[[kv_namespaces]]` de `wrangler.toml`. Tras el
   deploy, el binding aparece en Settings → Bindings.
5. Deploy. Cuotas free: 100.000 invocaciones de Functions/día (los estáticos,
   ilimitados). El mayor consumidor son los tiles de EFFIS.

### Keep-warm (cron externo)

Las dos primeras capas de cache son locales a cada datacenter de Cloudflare y
la de módulo muere con el isolate: sin tráfico, el primer visitante pagaría el
fan-out completo a FIRMS. Un cron externo (cron-job.org) hace
`GET https://<dominio>/api/warm` cada 4 minutos (`*/4 * * * *`) y mantiene KV
fresco — al ser KV global, da igual desde qué país pinche el cron.
`/api/warm` ejecuta el mismo `getFires` que `/api/fires` pero responde solo un
resumen (~94 bytes): cron-job.org rechaza cuerpos de respuesta grandes y la
respuesta completa pesa ~580 KB.

Prueba local del build de Cloudflare: `cp server/.env .dev.vars && npm run
preview:cf` (sirve en :8788 con workerd real).

Nota sobre PMTiles: el asset server de Pages no soporta peticiones HTTP Range,
que son la base de PMTiles. Lo resuelve `functions/data/[[path]].ts`: una
Function intercepta los `.pmtiles`, los mantiene en memoria del isolate y emula
el byte serving (206 + Content-Range). Si el volumen de teselas creciera, la
evolución natural es moverlas a R2 (Range nativo, también free plan).

## Endpoints del proxy

| Endpoint | Descripción |
|---|---|
| `GET /api/fires` | Focos de España y Portugal en las últimas 24 h (3 satélites VIIRS + MODIS fusionados) + ranking de localidades afectadas |
| `GET /api/effis/status` | Disponibilidad del WMS de EFFIS (sonda con fallback de endpoints) |
| `GET /api/effis/wms?range=7d&bbox=…` | Proxy del `GetMap` WMS de EFFIS (tiles raster para MapLibre) |
| `GET /api/warm` | Keep-warm para el cron: mismo refresco que `/api/fires`, respuesta mínima de ~94 bytes (solo en el despliegue Cloudflare) |
| `GET /api/health` | Comprobación de vida |
| `GET /incendios/<slug>` | Página SEO por localidad (solo Cloudflare): el index.html del deploy con title/description/canonical/H1 propios, miga de pan JSON-LD (`BreadcrumbList`) y enlaces a localidades vecinas, vía HTMLRewriter (pipeline en `functions/_lib/seo-page.ts`, ruta en `functions/incendios/[slug].ts`). Los slugs son el campo `s` de `muni-meta.json` (generados por `build-muni-index.mjs`, desambiguados por región en nombres duplicados) y se publican en `sitemap.xml` (`scripts/build-sitemap.mjs`, encadenado a `build:muni-index`). En Express estas rutas caen al index genérico y el cliente resuelve el slug igualmente |
| `GET /incendios/portugal` | Landing de país (solo Cloudflare, `functions/incendios/portugal.ts`): hub del cluster «mapa incendios portugal», con enlaces a los 18 concelhos capital de distrito. El slug `portugal` está reservado (asserts en los scripts de build); la SPA encuadra Portugal continental y ciñe el ranking a sus distritos |
| `GET /embed` | Mapa embebible en un `<iframe>` ajeno (ver abajo) |
| `GET /insertar` | Generador del código de inserción, indexable |

## Mapa embebible (`/embed`) y generador (`/insertar`)

### Cómo se embebe (lo que copia un medio)

Esto es exactamente lo que genera `/insertar` y lo que un periódico pega en su
gestor de contenidos. El `<div>` con `padding-bottom` es el truco de proporción
que hace que el mapa se adapte al ancho de la columna (funciona en cualquier CMS,
también en los que no dejan tocar el CSS):

```html
<div style="position:relative;width:100%;padding-bottom:62%">
  <iframe src="https://radarincendios.com/embed?base=claro"
    title="Mapa de incendios en España y Portugal en tiempo real"
    loading="lazy" allowfullscreen
    style="position:absolute;top:0;left:0;width:100%;height:100%;border:0"></iframe>
</div>
<p style="margin:.5rem 0;font:400 13px/1.4 system-ui,sans-serif">Fuente:
  <a href="https://radarincendios.com/" target="_blank" rel="noopener">Mapa de
  incendios en España y Portugal · Radar de Incendios</a></p>
```

Variante de alto fijo (para huecos de altura conocida en una plantilla):

```html
<iframe src="https://radarincendios.com/embed?base=claro" title="Mapa de incendios en España y Portugal en tiempo real"
  width="100%" height="520" style="border:0;display:block" loading="lazy" allowfullscreen></iframe>
```

Cada pieza está ahí por algo: `loading="lazy"` (no descarga nada hasta que el
lector se acerca), `allowfullscreen` (habilita el botón de pantalla completa del
widget), `title` (lo lee un lector de pantalla) y el párrafo de crédito, que es
la condición de uso y lo que devuelve tráfico y marca.

Un mapa centrado en un municipio, con tema claro y ranking de localidades:

```html
<iframe src="https://radarincendios.com/embed?localidad=zamora&zoom=10&tema=claro&ranking=1"
  title="Mapa de incendios en Zamora en tiempo real"
  width="100%" height="520" style="border:0;display:block" loading="lazy" allowfullscreen></iframe>
```

### Cómo está montado

El mapa se puede insertar en cualquier web con un `<iframe>`. No es una ruta de
la SPA: son **dos documentos más del build de Vite** (`client/embed.html` y
`client/insertar.html`, con entradas `src/embed.tsx` y `src/insertar.tsx`), así
que el iframe de un artículo ajeno no descarga la sidebar ni la prosa SEO de la
home, y `/insertar` no descarga MapLibre —su previsualización es un iframe a
`/embed`—. Cloudflare Pages sirve `embed.html` en `/embed` por su
`html_handling`; Express lo replica con `extensions: ['html']` y el dev-server de
Vite, con un pequeño rewrite en `vite.config.ts` (sin él, su fallback SPA
serviría la app).

- **Contrato de la URL**: `client/src/lib/embed.ts`. Lo comparten el parser del
  widget y el generador de `/insertar`: si se duplicara, el código que copia un
  periodista pintaría algo distinto de lo que previsualizó. Parámetros:
  `localidad`, `centro=lat,lon`, `zoom`, `capas=focos,quemado,viento,flujo,limites`,
  `tema=claro`, `base=satelite|oscuro|claro`, `controles=0`, `leyenda=0`,
  `ranking=1`.
- **Dos ejes independientes, y no se deben acoplar**: `?tema=` viste la
  **interfaz** (paneles, chips, leyenda: bloque `[data-tema='claro']` de
  `styles/tokens.css`, con los contrastes medidos anotados ahí) y `?base=` elige
  el **mapa base**. La **cartografía propia** —etiquetas, límites, humo, flujo—
  no la decide el tema sino el mapa base (`paletteThemeFor` en `map/layers.ts` →
  `MAP_LIGHT` en `styles/mapTokens.ts`, con su gemelo CSS `[data-carto='claro']`
  para los distintivos de la leyenda): lo que tiene que contrastar es con lo de
  debajo. Sobre CARTO Positron, los límites y el humo claros y translúcidos
  desaparecen. Las cuatro combinaciones son legítimas y el generador propone
  precisamente la mixta —**paneles oscuros sobre mapa claro**—, que es la que
  encaja en un artículo con fondo blanco sin perder legibilidad de marca y datos.
  Ambos ejes son **constantes por documento**: se resuelven al crear el mapa, así
  que no hay repintado en caliente que mantener; el destello inicial de la
  interfaz lo evita un `<script>` de tres líneas en `embed.html` que pone
  `data-tema` antes del primer pintado. La app propia sigue siendo solo oscura.
- **Defaults**: el contrato de la URL mantiene la casa (satélite + interfaz
  oscura), así que un `/embed` a pelo es lo de siempre. El **generador** arranca
  en paneles oscuros + Positron (`BUILDER_DEFAULTS` en `EmbedBuilder.tsx`) y por
  eso el snippet que copia un medio lleva `base=claro` explícito.
- **Diferencias con la app** (`EmbedView.tsx`): gestos cooperativos (el zoom con
  rueda exige Ctrl/⌘, si no el mapa se comería el scroll del artículo), botón de
  pantalla completa, sin escritura del hash, marca clicable con el contador de
  focos y enlace de vuelta con `utm_source=embed`, y crédito de las fuentes
  visible sin desplegar nada (lo exigen NASA FIRMS y Copernicus; el "i" de
  MapLibre pasa desapercibido en un iframe pequeño, y por eso el crédito a FIRMS
  también se cuelga ahora de la fuente GeoJSON de focos).
- **Coste**: el flujo de viento arranca **apagado** (animación continua + 109,2
  llamadas ponderadas de Open-Meteo por refresco) y el auto-refresco de focos es
  de 10 min en lugar de 5. `useFires` y `useEffisStatus` **pausan el refresco con
  la pestaña oculta** (antes una pestaña olvidada gastaba 288 invocaciones/día
  por visitante; embebido en un medio eso se multiplica). El snippet generado
  lleva `loading="lazy"`: un mapa al final de un artículo no pide nada hasta que
  el lector se acerca.
- **SEO**: `/embed` va `noindex, follow` (meta en el HTML + `X-Robots-Tag` en
  `_headers`) y **no** entra en el sitemap: es el interior de un iframe, no una
  página de aterrizaje. La indexable es `/insertar`, que sí está en el sitemap y
  lleva su prosa en el HTML estático (navegable sin JS). El retorno real de
  insertar el mapa en un medio es el **crédito enlazado** que acompaña al
  snippet, no el `src` del iframe: los iframes apenas transmiten autoridad.
- Ningún documento del sitio manda `X-Frame-Options` ni `CSP frame-ancestors`, y
  `client/public/_headers` lo deja escrito para que nadie los añada sin dejar
  exento `/embed`.

### Cómo se llega a `/insertar` (menú «Compartir»)

Implementado a partir de un handoff de Claude Design (2026-07-29). El acceso no
es un botón suelto: es el tercer ítem de un menú **«Compartir»** que comparte
fila con «Refrescar ahora» en la barra lateral (`ui/ShareMenu.tsx`), porque
«insertar» no es un control del mapa y no pertenece al grupo de capas.

- Tres ítems: copiar el enlace de la vista, copiar el enlace de la localidad
  activa (solo si hay una; si no, la fila no existe) e insertar en tu web
  (destacado, enlace real a `/insertar`). La confirmación de copiado ocurre **en
  el propio ítem**; el sistema no tiene avisos flotantes.
- **Solo escritorio**: en móvil el menú no se monta —nadie pega un iframe desde
  el móvil—. Allí el acceso es el `<details>` «Insertar este mapa de incendios en
  tu web» de «Sobre este mapa», que además es el que trabaja para el buscador
  (texto real). Y el pie de la barra enlaza a `/insertar` en las dos anchuras,
  también en las páginas `/incendios/<slug>`.
- Los enlaces se construyen en `lib/share.ts`, que **importa el vocabulario de
  capas de `lib/embed.ts`** (`LAYER_KEYS`): una sola tabla de nombres para
  `?capas=` en toda la base de código. La app **lee** ese parámetro al arrancar,
  así que un enlace compartido restaura encuadre (`#map=`) y capas; `flujo` nunca
  se enciende si el sistema pide reducir movimiento.
- El valor del ítem «enlace de esta vista» es una **función**, no una cadena: el
  hash lo escribe MapView con `history.replaceState`, que no provoca re-render, y
  una cadena calculada en el render se copiaría con el encuadre anterior.

### Primer pintado (por qué el fondo va en `html`)

`client/src/index.css` pinta el fondo en `html` y declara `color-scheme`, y los
tres documentos llevan `<meta name="color-scheme">`. No es cosmético: sin eso el
lienzo del navegador se queda en su blanco por defecto —el tema oscuro lo pintaba
solo el contenedor de la app— y la carga de `/insertar` se veía en tres tiempos
(blanco, texto, fondo). En `/embed?tema=claro` el `<script>` del `<head>` corrige
el `color-scheme` a `light` junto con `data-tema`.

El esqueleto estático de `insertar.html` usa **las mismas clases y medidas** que
`EmbedBuilder` (cabecera, ancho del contenedor, tamaño del `h1`), así que al
montar React no hay salto perceptible por encima del pliegue. Si se cambia uno,
hay que cambiar el otro.

## Rendimiento

- **Municipios en PMTiles** (tippecanoe, z6–z12): nada de GeoJSON de 8,7 MB en
  el navegador; cada vista descarga solo sus teselas por HTTP Range, con más
  detalle que la versión GeoJSON a zoom alto. Regenerar (líneas y etiquetas;
  la entrada de etiquetas la emite `scripts/merge-portugal.mjs`):
  `tippecanoe -f -o client/public/data/municipios.pmtiles -Z6 -z12 --detect-shared-borders --coalesce-densest-as-needed -l municipios server/data/municipios.json`
  y
  `tippecanoe -f -o client/public/data/municipios-labels.pmtiles -Z8 -z12 -r1 -l labels node_modules/.cache/geoboundaries/municipios-labels.geojson`.
- **Cache stale-while-revalidate en `/api/fires`**: fresco < 5 min se sirve de
  memoria; entre 5 y 30 min se responde al instante con el último dato bueno y
  la renovación corre en segundo plano; una ronda parcial (algún satélite
  caído) nunca sustituye a una foto completa anterior; single-flight para que N clientes
  simultáneos cuesten una sola ronda contra FIRMS.
- **Hedging contra FIRMS** (ambos backends): si una petición de área no
  responde en 4 s —o falla antes—, se lanza un duplicado idéntico y gana el
  primero en responder. FIRMS deja peticiones colgadas 10-20 s de vez en
  cuando: esto recorta el peor caso de ~25 s a ~17 s y el cuelgue típico a
  ~5-6 s, con un coste en transacciones irrelevante frente al cupo.
- **Payload ligero**: solo los campos del CSV que la UI usa (~19 KB gzip la
  respuesta completa con 1.700 focos); gzip activo en todo el servidor.
- **Cabeceras de cache en producción**: assets con hash → `immutable` 1 año;
  datos geográficos → 1 día con revalidación.
- **Build**: MapLibre y React en chunks separados (conservan hash y cache
  entre deploys; el código de la app son ~15 KB gzip); `preconnect` a los
  servidores de tiles/glifos; paneo limitado al entorno de la península
  ibérica y Canarias para no pedir tiles del resto del mundo.

## Notas sobre EFFIS

Los servicios WMS de EFFIS cambian de host y de estado con frecuencia, así que
el proxy **no asume un endpoint fijo**: sondea una lista ordenada de candidatos
con un `GetMap` pequeño y usa el primero que devuelva una imagen real
(verificado vía `GetCapabilities` el 2026-07-24; la lista vive en
`server/src/effis.ts`):

1. `maps.effis.emergency.copernicus.eu/effis` — capas `modis.ba` / `nrt.ba`,
   con dimensión `TIME` (permite filtrar 7 días / 30 días / temporada).
2. `ies-ows.jrc.ec.europa.eu/effis` — capa `ercc.ba` ("Current Season Burned
   Areas in last 30 days"), sin `TIME`: si es la que responde, el selector de
   rango se deshabilita con un aviso.

Si ningún endpoint responde, la app **degrada con elegancia**: sigue
funcionando solo con FIRMS y muestra el aviso "capa de perímetros EFFIS no
disponible".

## Estructura

```
├── package.json          # workspaces + scripts (dev/build/start/typecheck)
├── wrangler.toml         # config del proyecto Cloudflare Pages
├── functions/            # port del proxy a Pages Functions (producción CF)
│   ├── api/              # fires.ts, warm.ts, effis/status.ts, effis/wms.ts, health.ts
│   └── _lib/             # firms, effis, geo, impact (índice de rejilla), types
├── scripts/              # build-muni-index.mjs (índice espacial),
│                         # build-coverage-boundary.mjs (contorno ES+PT),
│                         # merge-portugal.mjs (fusiona la CAOP portuguesa)
├── server/               # proxy Express + TS (dev clásico y despliegue Node)
│   ├── data/             # municipios.json + ccaa.json para el join del ranking
│   └── src/
│       ├── index.ts      # rutas /api/*, estáticos del cliente en producción
│       ├── firms.ts      # FIRMS: fusión 4 sensores, ventana 24 h, SWR + single-flight
│       ├── effis.ts      # EFFIS: sonda de salud, fallback y proxy de tiles WMS
│       ├── impact.ts     # ranking de localidades (join espacial foco→municipio→región)
│       ├── geo.ts        # point-in-polygon (contorno de la cobertura + utilidades)
│       ├── data/         # coverage-boundary.json (ADM0 ES+PT, procesado)
│       ├── cache.ts      # cache TTL en memoria
│       └── types.ts      # FireHotspot, FiresResponse, RegionImpact, EffisStatus
└── client/               # React + Vite + TS + Tailwind
    ├── index.html        # app (SPA del mapa)
    ├── embed.html        # /embed  → widget embebible (noindex)
    ├── insertar.html     # /insertar → generador del código de inserción
    ├── public/data/      # ccaa.json (límites autonómicos y distritos PT)
    └── src/
        ├── hooks/        # useFires, useEffisStatus (auto-refresco, en pausa si
        │                 # la pestaña está oculta) + useFireMapData (la
        │                 # fontanería de datos que comparten app y embed)
        ├── lib/embed.ts  # contrato de la URL de /embed (parser + generador)
        ├── map/layers.ts # abstracción AppLayer (añadir fuentes nuevas = 1 función)
        └── components/   # MapView, Sidebar, Legend, FirePopup,
                          # EmbedView (widget), EmbedBuilder (/insertar)
```

### Añadir una capa nueva

`client/src/map/layers.ts` define la interfaz `AppLayer` (`add`, `setVisible`).
Para incorporar otra fuente (otro sensor FIRMS, capas del 112, etc.) basta con
escribir una función `create*Layer()` que la implemente y registrarla en el
`map.on('load', …)` de `MapView`.
