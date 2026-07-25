# 🔥 Firemaps · España

Aplicación web centrada en el **momento actual**: muestra en un mapa los
**focos de calor** detectados por satélite en las **últimas 24 horas**
(NASA FIRMS, unión de los tres satélites VIIRS —S-NPP, NOAA-20 y NOAA-21— más
MODIS/Terra-Aqua, que cubre el hueco de la tarde-noche) y
los **perímetros de área quemada** recientes (EFFIS / Copernicus) en España
(península, Baleares, Canarias, Ceuta y Melilla). No hay vistas históricas:
una sola vista, siempre al día.

FIRMS solo admite un rectángulo por petición, así que el proxy consulta dos
áreas en paralelo y fusiona los resultados (la lista vive en
`server/src/firms.ts`). Los focos de países vecinos que entran en esos
rectángulos se descartan con un point-in-polygon contra el contorno real de
España (`server/src/geo.ts` + `server/src/data/spain-boundary.json`,
procedente de geoBoundaries ADM0 con ~2 km de margen costero para no perder
detecciones pegadas a la costa).

- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS + MapLibre GL JS.
  Dos mapas base sin API key, conmutables desde el panel: imagen satelital
  (Esri World Imagery, al estilo del visor de FIRMS) y oscuro (CARTO Dark
  Matter `dark_nolabels`). Las etiquetas las pinta la app en castellano como
  capas de símbolos propias —los rasters de CARTO traen topónimos
  anglificados horneados—: nombres de las comunidades autónomas
  (`client/public/data/ccaa-labels.json`, centroides precalculados) y
  capitales/ciudades grandes (`client/public/data/cities.json`), con los
  límites administrativos de geoBoundaries escalonados por zoom: comunidades
  autónomas (`ccaa.json`), provincias desde zoom 6.5 (`provincias.json`) y los
  8.205 municipios desde zoom 7 en **teselas vectoriales PMTiles**
  (`municipios.pmtiles` + `municipios-labels.pmtiles`): el navegador pide por
  HTTP Range solo las teselas del viewport, con detalle adaptado al zoom.
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
| `GET /api/fires` | Focos de España en las últimas 24 h (3 satélites VIIRS + MODIS fusionados) + ranking de localidades afectadas |
| `GET /api/effis/status` | Disponibilidad del WMS de EFFIS (sonda con fallback de endpoints) |
| `GET /api/effis/wms?range=7d&bbox=…` | Proxy del `GetMap` WMS de EFFIS (tiles raster para MapLibre) |
| `GET /api/warm` | Keep-warm para el cron: mismo refresco que `/api/fires`, respuesta mínima de ~94 bytes (solo en el despliegue Cloudflare) |
| `GET /api/health` | Comprobación de vida |

## Rendimiento

- **Municipios en PMTiles** (tippecanoe, z6–z12): nada de GeoJSON de 7,5 MB en
  el navegador; cada vista descarga solo sus teselas por HTTP Range, con más
  detalle que la versión GeoJSON a zoom alto. Regenerar:
  `tippecanoe -o municipios.pmtiles -Z6 -z12 --detect-shared-borders --coalesce-densest-as-needed -l municipios <adm3.geojson>`.
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
  servidores de tiles/glifos; paneo limitado al entorno de España para no
  pedir tiles del resto del mundo.

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
├── scripts/              # build-muni-index.mjs (genera el índice espacial)
├── server/               # proxy Express + TS (dev clásico y despliegue Node)
│   ├── data/             # municipios.json + ccaa.json para el join del ranking
│   └── src/
│       ├── index.ts      # rutas /api/*, estáticos del cliente en producción
│       ├── firms.ts      # FIRMS: fusión 4 sensores, ventana 24 h, SWR + single-flight
│       ├── effis.ts      # EFFIS: sonda de salud, fallback y proxy de tiles WMS
│       ├── impact.ts     # ranking de localidades (join espacial foco→municipio→CCAA)
│       ├── geo.ts        # point-in-polygon (contorno de España + utilidades)
│       ├── data/         # spain-boundary.json (geoBoundaries ADM0, procesado)
│       ├── cache.ts      # cache TTL en memoria
│       └── types.ts      # FireHotspot, FiresResponse, RegionImpact, EffisStatus
└── client/               # React + Vite + TS + Tailwind
    ├── public/data/      # ccaa.json (límites autonómicos, geoBoundaries ADM1)
    └── src/
        ├── hooks/        # useFires, useEffisStatus (carga + auto-refresco 5 min)
        ├── map/layers.ts # abstracción AppLayer (añadir fuentes nuevas = 1 función)
        └── components/   # MapView, Sidebar, Legend, FirePopup
```

### Añadir una capa nueva

`client/src/map/layers.ts` define la interfaz `AppLayer` (`add`, `setVisible`).
Para incorporar otra fuente (otro sensor FIRMS, capas del 112, etc.) basta con
escribir una función `create*Layer()` que la implemente y registrarla en el
`map.on('load', …)` de `MapView`.
