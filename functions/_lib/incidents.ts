/**
 * Agregador de estado operativo de incendios: qué dicen las fuentes OFICIALES
 * (fase del incendio, medios desplegados) allí donde existen de forma
 * estructurada. Hoy: Bombers de la Generalitat (Catalunya, ArcGIS público,
 * ~10 min), datos abiertos de la Junta de Castilla y León (parte 2×/día) y
 * las activaciones Rapid Mapping de Copernicus EMS (señal de "incendio
 * grande" a escala europea). El resto de CCAA no publica API; se documenta la
 * cobertura parcial en la UI antes que scrapear webs que se romperán.
 * Portugal: ocorrências de ANEPC/Protección Civil vía api.fogos.pt (acceso
 * concedido 2026-08-01; requiere FOGOS_API_KEY en el entorno — sin ella la
 * fuente no se consulta). Atribución "Fonte: Fogos.pt" obligatoria: está en
 * el footer de la sidebar y en la etiqueta de procedencia del ranking.
 * Límite autenticado 2 req/min; este agregador hace ~1 cada 10 min.
 *
 * Cada fuente es OPCIONAL: se consultan en paralelo con timeout propio y la
 * caída de una no tumba la respuesta (sources[].ok lo cuenta). Caché en
 * Cache API + memo por isolate, TTL 10 min — las escrituras KV se reservan a
 * /api/fires, cuya fuente sí raciona peticiones.
 */

export type IncidentSource = 'bombers-cat' | 'jcyl' | 'copernicus-ems' | 'fogos-pt';
export type IncidentState = 'activo' | 'estabilizado' | 'controlado' | 'extinguido' | null;

export interface OperationalIncident {
  source: IncidentSource;
  lat: number;
  lon: number;
  /** Fase normalizada del incendio; null si la fuente no la da (EMS). */
  state: IncidentState;
  /** IGR 0-2 (JCyL) o código de activación (EMSR···). */
  level?: string;
  resources?: { vehicles?: number; personnel?: number; aerial?: number };
  /** Medios en texto libre (JCyL no los estructura). */
  resourcesText?: string;
  municipality?: string;
  /** Título del evento (EMS). */
  title?: string;
  startedAt?: string;
  updatedAt: string;
}

export interface IncidentsResponse {
  count: number;
  fetchedAt: string;
  cached: boolean;
  sources: Array<{ id: IncidentSource; ok: boolean; count: number }>;
  incidents: OperationalIncident[];
}

const CACHE_KEY = 'https://firemap.cache/api/incidents-v1';
const FRESH_MS = 10 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 8_000;

let memo: { at: number; response: IncidentsResponse } | null = null;

const BOMBERS_URL =
  'https://services7.arcgis.com/ZCqVt1fRXwwK6GF4/arcgis/rest/services/' +
  'ACTUACIONS_URGENTS_online_PRO_AMB_FASE_VIEW/FeatureServer/0/query' +
  '?where=1%3D1&outFields=*&f=geojson';

const JCYL_URL =
  'https://analisis.datosabiertos.jcyl.es/api/records/1.0/search/' +
  '?dataset=incendios-forestales&rows=100&sort=fecha_del_parte';

const EMS_URL =
  'https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=60';

const FOGOS_URL = 'https://api.fogos.pt/v2/incidents/active';

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    // UA identificable: el fetch de Workers no manda ninguno y algún WAF
    // (p. ej. el del backend de Copernicus EMS) rechaza peticiones sin él.
    // Es el MISMO UA declarado en la solicitud de acceso a api.fogos.pt
    // (formato que ellos piden): si cambia, avisarles.
    headers: { 'User-Agent': 'FiremapsSpain/1.0 (https://firemapsspain.online)', ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Bombers: fases en catalán → contrato. */
const BOMBERS_STATES: Record<string, IncidentState> = {
  actiu: 'activo',
  estabilitzat: 'estabilizado',
  controlat: 'controlado',
  extingit: 'extinguido',
};

async function fetchBombers(): Promise<OperationalIncident[]> {
  const body = (await fetchJson(BOMBERS_URL)) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: Record<string, unknown>;
    }>;
  };
  const out: OperationalIncident[] = [];
  const now = Date.now();
  for (const f of body.features ?? []) {
    const p = f.properties ?? {};
    // Solo incendios de vegetación (código estable; el texto lleva acentos).
    if (str(p.TAL_COD_ALARMA1) !== 'IV') continue;
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (num(lat) === null || num(lon) === null) continue;
    const state = BOMBERS_STATES[(str(p.COM_FASE) ?? '').toLowerCase()] ?? null;
    const updatedMs = num(p.DATA_ACT) ?? num(p.ACT_DAT_ACTUAL) ?? now;
    // Los extinguidos salen de la vista al día: son cierre, no seguimiento.
    if (state === 'extinguido' && now - updatedMs > 24 * 60 * 60 * 1000) continue;
    const vehicles = num(p.ACT_NUM_VEH);
    out.push({
      source: 'bombers-cat',
      lat: lat as number,
      lon: lon as number,
      state,
      ...(vehicles !== null && vehicles > 0 ? { resources: { vehicles } } : {}),
      municipality: str(p.MUNICIPI_DPX) ?? undefined,
      startedAt: num(p.ACT_DAT_INICI) ? new Date(p.ACT_DAT_INICI as number).toISOString() : undefined,
      updatedAt: new Date(updatedMs).toISOString(),
    });
  }
  return out;
}

/** JCyL publica un registro por PARTE (2/día): la identidad de un incendio es
 *  municipio+fecha de inicio y solo vale su último parte. */
async function fetchJcyl(): Promise<OperationalIncident[]> {
  const body = (await fetchJson(JCYL_URL)) as {
    records?: Array<{ fields?: Record<string, unknown> }>;
  };
  const JCYL_STATES: Record<string, IncidentState> = {
    activo: 'activo',
    estabilizado: 'estabilizado',
    controlado: 'controlado',
    extinguido: 'extinguido',
  };
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const byIncident = new Map<string, OperationalIncident & { parteAt: number }>();
  for (const record of body.records ?? []) {
    const f = record.fields ?? {};
    const pos = f.posicion as unknown;
    // ODS publica posicion como [lat, lon].
    if (!Array.isArray(pos) || num(pos[0]) === null || num(pos[1]) === null) continue;
    const parteAt = Date.parse(
      `${str(f.fecha_del_parte) ?? ''}T${str(f.hora_del_parte) ?? '00:00'}:00Z`
    );
    if (!Number.isFinite(parteAt) || parteAt < cutoff) continue;
    const key = `${str(f.termino_municipal) ?? ''}|${str(f.fecha_de_inicio) ?? ''}`;
    const seen = byIncident.get(key);
    if (seen && seen.parteAt >= parteAt) continue;
    const startedAt =
      str(f.fecha_de_inicio) !== null
        ? `${f.fecha_de_inicio as string}T${str(f.hora_de_inicio) ?? '00:00'}:00Z`
        : undefined;
    byIncident.set(key, {
      source: 'jcyl',
      lat: pos[0] as number,
      lon: pos[1] as number,
      state: JCYL_STATES[(str(f.situacion_actual) ?? '').toLowerCase()] ?? null,
      level: str(f.nivel) ?? undefined,
      resourcesText: str(f.medios_de_extincion)?.slice(0, 240) ?? undefined,
      municipality: str(f.termino_municipal) ?? undefined,
      startedAt,
      updatedAt: new Date(parteAt).toISOString(),
      parteAt,
    });
  }
  return [...byIncident.values()].map(({ parteAt: _drop, ...incident }) => incident);
}

async function fetchEms(): Promise<OperationalIncident[]> {
  const body = (await fetchJson(EMS_URL)) as {
    results?: Array<Record<string, unknown>>;
  };
  const out: OperationalIncident[] = [];
  for (const r of body.results ?? []) {
    if (str(r.category) !== 'Wildfire' || r.closed === true) continue;
    const countries = Array.isArray(r.countries) ? (r.countries as string[]) : [];
    if (!countries.some((c) => c === 'Spain' || c === 'Portugal')) continue;
    const wkt = str(r.centroid) ?? '';
    const match = /POINT \((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)/.exec(wkt);
    if (!match) continue;
    out.push({
      source: 'copernicus-ems',
      lat: Number(match[2]),
      lon: Number(match[1]),
      state: null,
      level: str(r.code) ?? undefined,
      title: str(r.name) ?? undefined,
      startedAt: str(r.eventTime) ?? undefined,
      updatedAt: str(r.lastUpdate) ?? new Date().toISOString(),
    });
  }
  return out;
}

/**
 * Fases ANEPC → contrato, por TEXTO normalizado: el statusCode de fogos.pt
 * no es una escalera 1..N estable (se han visto códigos 4 y 9), el nombre sí.
 * Despacho/Em Curso/Chegada = trabajándose; Em Resolução = ya no avanza;
 * Conclusão = rescaldo; Vigilância = extinguido con vigilancia posterior.
 */
function fogosState(status: string): IncidentState {
  const s = status
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (s.includes('vigilancia')) return 'extinguido';
  if (s.includes('conclusao')) return 'controlado';
  if (s.includes('resolucao')) return 'estabilizado';
  if (s.includes('despacho') || s.includes('curso') || s.includes('chegada')) return 'activo';
  return null;
}

async function fetchFogos(apiKey: string): Promise<OperationalIncident[]> {
  const body = (await fetchJson(FOGOS_URL, { 'X-API-Key': apiKey })) as {
    success?: boolean;
    data?: Array<Record<string, unknown>>;
  };
  if (body.success !== true) throw new Error('fogos.pt devolvió success=false');
  const out: OperationalIncident[] = [];
  for (const f of body.data ?? []) {
    if (f.isFire !== true) continue; // fuera accidentes/otras ocorrências
    const lat = num(f.lat);
    const lon = num(f.lng);
    if (lat === null || lon === null) continue;
    const resources: { vehicles?: number; personnel?: number; aerial?: number } = {};
    const personnel = num(f.man);
    const vehicles = num(f.terrain);
    const aerial = num(f.aerial);
    if (personnel) resources.personnel = personnel;
    if (vehicles) resources.vehicles = vehicles;
    if (aerial) resources.aerial = aerial;
    const startedSec = num((f.dateTime as { sec?: number } | undefined)?.sec);
    out.push({
      source: 'fogos-pt',
      lat,
      lon,
      state: fogosState(str(f.status) ?? ''),
      ...(Object.keys(resources).length > 0 ? { resources } : {}),
      municipality: str(f.concelho) ?? undefined,
      startedAt: startedSec ? new Date(startedSec * 1000).toISOString() : undefined,
      updatedAt: new Date().toISOString(),
    });
  }
  return out;
}

export async function getIncidents(
  env: { FOGOS_API_KEY?: string },
  waitUntil?: (p: Promise<unknown>) => void
): Promise<IncidentsResponse> {
  const now = Date.now();
  if (memo && now - memo.at < FRESH_MS) {
    return { ...memo.response, cached: true };
  }

  // Isolate frío: la Cache API puede tener la respuesta de otro isolate.
  try {
    const hit = await caches.default.match(CACHE_KEY);
    if (hit) {
      const cached = (await hit.json()) as IncidentsResponse;
      if (now - Date.parse(cached.fetchedAt) < FRESH_MS) {
        memo = { at: Date.parse(cached.fetchedAt), response: cached };
        return { ...cached, cached: true };
      }
    }
  } catch {
    // mejor-esfuerzo
  }

  // Portugal solo con token configurado: sin él ni se intenta (y sources no
  // lo lista, para no aparentar una fuente caída).
  const fogosKey = env.FOGOS_API_KEY;
  const tasks: Array<{ id: IncidentSource; run: Promise<OperationalIncident[]> }> = [
    { id: 'bombers-cat', run: fetchBombers() },
    { id: 'jcyl', run: fetchJcyl() },
    { id: 'copernicus-ems', run: fetchEms() },
    ...(fogosKey ? [{ id: 'fogos-pt' as const, run: fetchFogos(fogosKey) }] : []),
  ];
  const settled = await Promise.allSettled(tasks.map((t) => t.run));
  const pick = (r: PromiseSettledResult<OperationalIncident[]>) =>
    r.status === 'fulfilled' ? r.value : null;

  const lists = settled.map(pick);
  const ids = tasks.map((t) => t.id);
  const incidents = lists.flatMap((list) => list ?? []);
  const response: IncidentsResponse = {
    count: incidents.length,
    fetchedAt: new Date(now).toISOString(),
    cached: false,
    sources: ids.map((id, i) => ({ id, ok: lists[i] !== null, count: lists[i]?.length ?? 0 })),
    incidents,
  };

  // Con TODAS las fuentes caídas se conserva el memo viejo si existe (stale
  // mejor que vacío); si no, se devuelve el vacío honesto (sources lo cuenta).
  if (incidents.length === 0 && response.sources.every((s) => !s.ok) && memo) {
    return { ...memo.response, cached: true };
  }

  memo = { at: now, response };
  const persist = caches.default
    .put(
      CACHE_KEY,
      new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
      })
    )
    .catch(() => {});
  if (waitUntil) waitUntil(persist);
  else await persist;

  return response;
}
